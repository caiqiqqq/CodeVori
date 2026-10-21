#!/usr/bin/env python3
"""Mirror complete public CodeVori releases, then atomically publish manifests."""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


TAG = re.compile(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?\Z")
REPOSITORY = "caiqiqqq/CodeVori"


def version_key(tag):
    match = TAG.fullmatch(tag)
    if not match:
        raise ValueError("Invalid release tag")
    major, minor, patch, preview = match.groups()
    tokens = tuple((0, int(s)) if s.isdigit() else (1, s) for s in (preview or "").split("."))
    return int(major), int(minor), int(patch), preview is None, tokens


def installer_groups(version):
    prefix = f"CodeVori-{version}-"
    return {
        "windows-x86_64": [prefix + "win-x64.exe"],
        "darwin-aarch64": [prefix + "mac-arm64.zip", prefix + "mac-arm64.dmg"],
        "darwin-x86_64": [prefix + "mac-x64.zip", prefix + "mac-x64.dmg"],
        "linux-x86_64": [prefix + suffix for suffix in (
            "linux-x86_64.AppImage", "linux-amd64.deb", "linux-x86_64.rpm", "linux-x64.pkg.tar.zst"
        )],
    }


def open_url(url, headers=None):
    if not url.startswith("https://"):
        raise ValueError("Only HTTPS sources are allowed")
    request = Request(url, headers={"User-Agent": "CodeVori-release-mirror/1.0", **(headers or {})})
    return urlopen(request, timeout=60)


def retry(operation):
    for attempt in range(3):
        try:
            return operation()
        except (OSError, URLError) as error:
            if isinstance(error, HTTPError) and 400 <= error.code < 500 and error.code != 429:
                raise
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def read_url(url, headers=None):
    def read():
        with open_url(url, headers) as response:
            body = response.read(4 * 1024 * 1024 + 1)
        if len(body) > 4 * 1024 * 1024:
            raise ValueError("Metadata exceeds size limit")
        return body
    return retry(read)


def asset_url(repository, tag, name):
    return f"https://github.com/{repository}/releases/download/{quote(tag, safe='')}/{quote(name, safe='')}"


def download_url(repository, tag, asset):
    # 服务器到 github.com 下载入口会超时；asset API 可直接重定向到同一官方 CDN。
    asset_id = asset.get("id")
    if isinstance(asset_id, int) and asset_id > 0:
        return f"https://api.github.com/repos/{repository}/releases/assets/{asset_id}"
    return asset_url(repository, tag, asset["name"])


def verify_digest(data, asset):
    digest = asset.get("digest")
    if digest and digest != "sha256:" + hashlib.sha256(data).hexdigest():
        raise ValueError(f"GitHub digest mismatch: {asset['name']}")
    if len(data) != asset["size"]:
        raise ValueError(f"Asset size mismatch: {asset['name']}")


def read_checksums(repository, tag, asset, names):
    raw = read_url(download_url(repository, tag, asset), {"Accept": "application/octet-stream"})
    verify_digest(raw, asset)
    result = {}
    for line in raw.decode("utf-8").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64}) [ *]([^/\\]+)", line)
        if not match or match[2] not in names or match[2] in result:
            raise ValueError("Unexpected or duplicate checksum entry")
        result[match[2]] = match[1]
    if set(result) != set(names):
        raise ValueError("Incomplete checksums")
    return result


def file_info(path):
    sha256, sha512 = hashlib.sha256(), hashlib.sha512()
    size = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            sha256.update(chunk)
            sha512.update(chunk)
            size += len(chunk)
    return sha256.hexdigest(), base64.b64encode(sha512.digest()).decode("ascii"), size


def mirror_asset(root, repository, tag, asset, checksum):
    name = asset["name"]
    if asset.get("digest") and asset["digest"] != "sha256:" + checksum:
        raise ValueError(f"Checksum disagrees with GitHub: {name}")
    destination = root / "releases" / tag / checksum / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        actual, sha512, size = file_info(destination)
        if actual == checksum and size == asset["size"]:
            return {"url": "/" + str(destination.relative_to(root)), "sha512": sha512, "size": size}

    def download():
        incoming = root / ".incoming"
        incoming.mkdir(exist_ok=True)
        temporary = incoming / f"{checksum}-{name}.part"
        try:
            offset = temporary.stat().st_size if temporary.exists() else 0
            if offset > asset["size"]:
                temporary.unlink()
                offset = 0
            if offset < asset["size"]:
                headers = {"Accept": "application/octet-stream"}
                if offset:
                    headers["Range"] = f"bytes={offset}-"
                with open_url(download_url(repository, tag, asset), headers) as source:
                    # CDN 忽略 Range 时必须重写文件，不能把整包追加到旧内容。
                    if offset and source.status != 206:
                        offset = 0
                    if offset and not source.getheader("Content-Range", "").startswith(f"bytes {offset}-"):
                        raise ValueError(f"Invalid resume response: {name}")
                    with temporary.open("ab" if offset else "wb") as output:
                        size = offset
                        while chunk := source.read(1024 * 1024):
                            size += len(chunk)
                            if size > asset["size"]:
                                raise ValueError(f"Oversized download: {name}")
                            output.write(chunk)
            actual, sha512, size = file_info(temporary)
            if actual != checksum or size != asset["size"]:
                raise ValueError(f"Downloaded checksum/size mismatch: {name}")
            os.chmod(temporary, 0o644)
            os.replace(temporary, destination)
            print(f"Mirrored {name} ({size} bytes)", flush=True)
            return {"url": "/" + str(destination.relative_to(root)), "sha512": sha512, "size": size}
        except ValueError:
            temporary.unlink(missing_ok=True)
            raise
        # 网络错误/服务重启保留这个资产的已下载部分，下一次从断点继续。
    return retry(download)


def current_state(channel_path):
    try:
        return json.loads((channel_path / ".state.json").read_text())
    except FileNotFoundError:
        return None


def publish_snapshot(root, channel, fingerprint, manifests, state):
    parent = root / "manifests"
    snapshots = parent / ".snapshots" / channel
    snapshots.mkdir(parents=True, exist_ok=True)
    snapshot = snapshots / fingerprint
    if snapshot.exists() and any(not (snapshot / f"{name}.json").is_file() for name in [*manifests, ".state"]):
        snapshot.rename(snapshots / f".incomplete-{fingerprint}-{time.time_ns()}")
    if not snapshot.exists():
        with tempfile.TemporaryDirectory(prefix=".snapshot-", dir=snapshots) as temporary:
            for name, content in {**manifests, ".state": state}.items():
                (Path(temporary) / f"{name}.json").write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n")
            os.chmod(temporary, 0o755)
            os.rename(temporary, snapshot)
    current = parent / channel
    if current.is_dir() and not current.is_symlink():
        current.rename(parent / f".{channel}.before-mirror-{time.time_ns()}")
    next_link = parent / f".{channel}.next"
    next_link.unlink(missing_ok=True)
    next_link.symlink_to(snapshot.relative_to(parent), target_is_directory=True)
    os.replace(next_link, current)


def sync_release(root, repository, release):
    if release.get("draft"):
        raise ValueError("Draft releases cannot be mirrored")
    tag = release["tag_name"]
    version_key(tag)
    channel = "preview" if release["prerelease"] else "stable"
    groups = installer_groups(tag[1:])
    desktop = [name for names in groups.values() for name in names]
    assets = {}
    for asset in release["assets"]:
        name = asset["name"]
        if name in assets:
            raise ValueError("Duplicate release asset")
        if not isinstance(asset.get("size"), int) or asset["size"] <= 0:
            raise ValueError("Empty or invalid release asset")
        assets[name] = asset
    missing = set(desktop + ["SHA256SUMS"]) - assets.keys()
    if missing:
        print(f"Waiting for complete {tag}: {', '.join(sorted(missing))}", flush=True)
        return False
    mobile = [f"CodeVori-{tag[1:]}-android-arm64-test.apk", f"CodeVori-{tag[1:]}-ios-simulator-arm64.app.zip"]
    mobile_ready = all(name in assets for name in mobile + ["SHA256SUMS-mobile"])
    selected = desktop + (mobile if mobile_ready else [])
    checksums = ["SHA256SUMS"] + (["SHA256SUMS-mobile"] if mobile_ready else [])
    fingerprint = hashlib.sha256(json.dumps({
        "id": release["id"], "tag": tag, "channel": channel,
        "notes": release.get("body"), "date": release["published_at"],
        # 下载计数随访问变化，不能用于判断版本变化，否则每次轮询都会重建快照。
        "assets": [{key: assets[name].get(key) for key in ("id", "name", "size", "digest", "updated_at")}
                   for name in selected + checksums],
    }, sort_keys=True).encode()).hexdigest()
    current = root / "manifests" / channel
    state = current_state(current)
    if state and version_key(tag) < version_key(state["tag"]):
        raise ValueError(f"Refusing {channel} downgrade to {tag}")
    if state and state["fingerprint"] == fingerprint:
        files = state["files"]
        if all((root / info["url"].lstrip("/")).is_file() and
               (root / info["url"].lstrip("/")).stat().st_size == info["size"] for info in files.values()) and all(
                   (current / f"{platform}.json").is_file() for platform in groups):
            print(f"Unchanged {channel} {tag}", flush=True)
            return True
    hashes = read_checksums(repository, tag, assets["SHA256SUMS"], desktop)
    if mobile_ready:
        hashes.update(read_checksums(repository, tag, assets["SHA256SUMS-mobile"], mobile))
    print(f"Syncing {channel} {tag}: {len(selected)} installers", flush=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda name: mirror_asset(root, repository, tag, assets[name], hashes[name]), selected))
    files = dict(zip(selected, results))
    manifests = {platform: {
        "version": tag[1:], "releaseDate": release["published_at"],
        "releaseNotes": release.get("body") or "",
        "files": [files[name] for name in names],
    } for platform, names in groups.items()}
    state = {"tag": tag, "fingerprint": fingerprint, "files": files}
    publish_snapshot(root, channel, fingerprint, manifests, state)
    print(f"Published {channel} {tag}", flush=True)
    return True


@contextmanager
def sync_lock(root):
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".release-sync.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/srv/codevori-update"))
    parser.add_argument("--repository", default=REPOSITORY)
    args = parser.parse_args()
    if not re.fullmatch(r"[\w-]+/[\w.-]+", args.repository):
        parser.error("Invalid repository")
    api = f"https://api.github.com/repos/{args.repository}"
    with sync_lock(args.root):
        releases = []
        try:
            releases.append(json.loads(read_url(api + "/releases/latest")))
        except HTTPError as error:
            if error.code != 404:
                raise
        catalog = json.loads(read_url(api + "/releases?per_page=100"))
        previews = [r for r in catalog if r["prerelease"] and not r["draft"] and TAG.fullmatch(r["tag_name"])]
        if previews:
            releases.append(max(previews, key=lambda r: version_key(r["tag_name"])))
        failures = []
        for release in releases:
            try:
                sync_release(args.root, args.repository, release)
            except (OSError, ValueError, KeyError) as error:
                failures.append(f"{release['tag_name']}: {error}")
        if failures:
            raise RuntimeError("; ".join(failures))


if __name__ == "__main__":
    main()
