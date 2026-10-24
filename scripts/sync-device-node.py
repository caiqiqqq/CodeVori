#!/usr/bin/env python3
"""Mirror independent execution clients from the latest stable GitHub release."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from urllib.error import HTTPError

# 复用主程序镜像已经验证的 HTTPS、GitHub asset API、断点续传、校验和互斥锁。
SPEC = importlib.util.spec_from_file_location("release_mirror", Path(__file__).with_name("sync-github-releases.py"))
mirror = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mirror)

SERVICE_URL = "https://aimodetest.cn/device-node"
ASSETS_URL = "https://aimodetest.cn/codevori-node/clients"
CLIENTS = {f"{platform}-{arch}": f"CodeVoriNode-{platform}-{arch}" + (".exe" if platform == "win32" else "")
           for platform in ("win32", "darwin", "linux") for arch in ("x64", "arm64")}
MARKER = "device-node-manifest.json"
LICENSE = "CodeVoriNode-LICENSE.txt"
CHECKSUMS = "SHA256SUMS-device-node"
VERSION = re.compile(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\Z")


def version_key(version):
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError("Invalid independent client version")
    return tuple(map(int, version.split(".")))


def validate_manifest(manifest, service_url, assets_url):
    version_key(manifest.get("version"))
    if (manifest.get("serviceUrl") != service_url or manifest.get("dirty") is not False or
            not re.fullmatch(r"[a-f0-9]{40}", manifest.get("source", ""))):
        raise ValueError("Invalid client source or service URL")
    files = manifest.get("files")
    if not isinstance(files, list) or len(files) != len(CLIENTS):
        raise ValueError("Incomplete client manifest")
    expected = set(CLIENTS)
    for file in files:
        platform = file.get("platform")
        if platform not in expected or file.get("name") != CLIENTS[platform]:
            raise ValueError("Invalid or duplicate client platform")
        expected.remove(platform)
        if (type(file.get("bytes")) is not int or not 0 < file["bytes"] <= 128 * 1024 * 1024 or
                not re.fullmatch(r"[a-f0-9]{64}", file.get("sha256", "")) or
                file.get("url") != f"{assets_url}/{manifest['version']}/{file['name']}"):
            raise ValueError("Invalid client length, hash or URL")


def fetch_manifest(repository, release):
    assets = {}
    for asset in release["assets"]:
        name = asset["name"]
        if name in assets:
            raise ValueError("Duplicate release asset")
        assets[name] = asset
    names = [*CLIENTS.values(), LICENSE, MARKER]
    if not set([*names, CHECKSUMS]) <= assets.keys():
        return None, None
    for name in [*names, CHECKSUMS]:
        size = assets[name].get("size")
        limit = 128 * 1024 * 1024 if name in CLIENTS.values() else 1024 * 1024
        if type(size) is not int or not 0 < size <= limit:
            raise ValueError(f"Invalid client release asset size: {name}")
    hashes = mirror.read_checksums(repository, release["tag_name"], assets[CHECKSUMS], names)
    raw = mirror.read_url(mirror.download_url(repository, release["tag_name"], assets[MARKER]),
                          {"Accept": "application/octet-stream"})
    mirror.verify_digest(raw, assets[MARKER])
    if hashlib.sha256(raw).hexdigest() != hashes[MARKER]:
        raise ValueError("Client manifest integrity mismatch")
    return (assets, hashes), json.loads(raw)


def verify_directory(directory, manifest, license_hash):
    for file in manifest["files"]:
        path = directory / file["name"]
        if not path.is_file() or path.is_symlink():
            raise ValueError("Published client integrity mismatch")
        checksum, _, size = mirror.file_info(path)
        if checksum != file["sha256"] or size != file["bytes"]:
            raise ValueError("Published client integrity mismatch")
    license_path = directory / "LICENSE.txt"
    if license_path.is_symlink() or not license_path.is_file() or mirror.file_info(license_path)[0] != license_hash:
        raise ValueError("Published license integrity mismatch")


def payload_identity(manifest):
    return {"version": manifest["version"], "serviceUrl": manifest["serviceUrl"],
            "files": sorted(manifest["files"], key=lambda f: f["platform"])}


def publish_clients(root, stage, manifest, license_hash):
    clients = root / "clients"
    clients.mkdir(exist_ok=True)
    current = clients / "current"
    if current.exists():
        old = json.loads((current / "manifest.json").read_text())
        if version_key(manifest["version"]) < version_key(old["version"]):
            raise ValueError("Refusing client downgrade")
    destination = clients / manifest["version"]
    if destination.exists():
        old = json.loads((destination / "manifest.json").read_text())
        if payload_identity(old) != payload_identity(manifest):
            raise ValueError("Immutable client version conflict; bump device-node-version.json")
        # 同一版本的来源元数据可以不同；二进制及许可证必须一致，并保留首次发布清单。
        verify_directory(destination, old, license_hash)
    else:
        verify_directory(stage, manifest, license_hash)
        for path in stage.iterdir():
            path.chmod(0o644)
        stage.chmod(0o755)
        os.rename(stage, destination)
    latest = clients / "latest.json"
    temporary_latest = clients / ".latest.next"
    temporary_latest.unlink(missing_ok=True)
    temporary_latest.symlink_to("current/manifest.json")
    # 先迁移 latest 到旧 current 的清单，再原子切换唯一发布指针，避免两份版本状态。
    # 首次发布尚无 current 时先创建 current，最后暴露 latest。
    if current.exists():
        os.replace(temporary_latest, latest)
    temporary = clients / ".current.next"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(manifest["version"], target_is_directory=True)
    os.replace(temporary, current)
    if temporary_latest.is_symlink():
        os.replace(temporary_latest, latest)


def sync_release(root, repository, release, service_url=SERVICE_URL, assets_url=ASSETS_URL):
    if release.get("draft") or release.get("prerelease"):
        return False
    mirror.version_key(release["tag_name"])
    selected = set([*CLIENTS.values(), LICENSE, MARKER, CHECKSUMS])
    fingerprint = hashlib.sha256(json.dumps({
        "repository": repository, "tag": release["tag_name"], "service": service_url, "assetsUrl": assets_url,
        "assets": [{key: asset.get(key) for key in ("id", "name", "size", "digest", "updated_at")}
                   for asset in release["assets"] if asset["name"] in selected],
    }, sort_keys=True).encode()).hexdigest()
    state_path = root / ".node-sync-state.json"
    if state_path.is_file():
        state = json.loads(state_path.read_text())
        current = root / "clients/current/manifest.json"
        if state.get("fingerprint") == fingerprint and current.is_file():
            raw = current.read_bytes()
            if hashlib.sha256(raw).hexdigest() == state["manifestSha256"]:
                verify_directory(current.parent, json.loads(raw), state["licenseSha256"])
                if (root / "clients/latest.json").is_symlink() and (root / "clients/latest.json").readlink() == Path("current/manifest.json"):
                    # GitHub 匿名 API 有小时限额；资产指纹未变时只校验本地，不重复获取两份元数据。
                    print(f"Unchanged execution clients {state['version']}", flush=True)
                    return True
    fetched, manifest = fetch_manifest(repository, release)
    if manifest is None:
        print(f"Waiting for complete execution clients: {release['tag_name']}", flush=True)
        return False
    validate_manifest(manifest, service_url, assets_url)
    assets, hashes = fetched
    for file in manifest["files"]:
        asset = assets[file["name"]]
        if file["sha256"] != hashes[file["name"]] or file["bytes"] != asset["size"]:
            raise ValueError("Client manifest disagrees with release checksums/length")
    current = root / "clients/current/manifest.json"
    if current.exists() and version_key(manifest["version"]) < version_key(json.loads(current.read_text())["version"]):
        raise ValueError("Refusing client downgrade")
    incoming = root / ".incoming"
    incoming.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="publish-", dir=incoming) as temporary:
        stage = Path(temporary)
        names = [*CLIENTS.values(), LICENSE]
        cache = root / ".cache"
        cache.mkdir(exist_ok=True)
        with ThreadPoolExecutor(max_workers=3) as pool:
            paths = list(pool.map(lambda name: mirror.mirror_asset(cache, repository, release["tag_name"], assets[name], hashes[name]), names))
        for name, info in zip(names, paths):
            shutil.copyfile(cache / info["url"].lstrip("/"), stage / ("LICENSE.txt" if name == LICENSE else name))
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        publish_clients(root, stage, manifest, hashes[LICENSE])
    state = {"fingerprint": fingerprint, "version": manifest["version"], "licenseSha256": hashes[LICENSE],
             "manifestSha256": hashlib.sha256((root / "clients/current/manifest.json").read_bytes()).hexdigest()}
    temporary_state = root / ".node-sync-state.next"
    temporary_state.write_text(json.dumps(state) + "\n")
    os.replace(temporary_state, state_path)
    print(f"Published execution clients {manifest['version']} from {release['tag_name']}", flush=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/srv/codevori-node"))
    parser.add_argument("--repository", default=mirror.REPOSITORY)
    args = parser.parse_args()
    if not re.fullmatch(r"[\w-]+/[\w.-]+", args.repository):
        parser.error("Invalid repository")
    with mirror.sync_lock(args.root):
        try:
            release = json.loads(mirror.read_url(f"https://api.github.com/repos/{args.repository}/releases/latest"))
        except HTTPError as error:
            if error.code != 404:
                raise
            print("No stable GitHub release yet", flush=True)
            return
        sync_release(args.root, args.repository, release)


if __name__ == "__main__":
    main()
