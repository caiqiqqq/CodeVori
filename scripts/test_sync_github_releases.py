import base64
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("release_sync", Path(__file__).with_name("sync-github-releases.py"))
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.contents = {}
        self.release = self.fixture("v0.0.3")
        self.requests = []
        self.patcher = patch.object(sync, "open_url", self.open_url)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def fixture(self, tag, mobile=False, preview=False):
        names = [name for group in sync.installer_groups(tag[1:]).values() for name in group]
        assets = []
        def add(name, body):
            asset = {"id": len(self.contents) + 1, "name": name, "size": len(body),
                     "digest": "sha256:" + hashlib.sha256(body).hexdigest()}
            assets.append(asset)
            self.contents[sync.download_url(sync.REPOSITORY, tag, asset)] = body
        for name in names:
            add(name, ("installer " + name).encode())
        sums = "".join(f"{a['digest'][7:]}  {a['name']}\n" for a in assets)
        add("SHA256SUMS", sums.encode())
        if mobile:
            phones = [f"CodeVori-{tag[1:]}-android-arm64-test.apk", f"CodeVori-{tag[1:]}-ios-simulator-arm64.app.zip"]
            for name in phones:
                add(name, name.encode())
            add("SHA256SUMS-mobile", "".join(f"{a['digest'][7:]}  {a['name']}\n" for a in assets if a["name"] in phones).encode())
        return {"id": 1, "tag_name": tag, "prerelease": preview, "draft": False,
                "published_at": "2026-10-20T14:42:27Z", "body": "release notes", "assets": assets}

    def open_url(self, url, headers=None):
        self.requests.append(url)
        return io.BytesIO(self.contents[url])

    def run_sync(self, release=None):
        return sync.sync_release(self.root, sync.REPOSITORY, release or self.release)

    def test_complete_release_hashes_and_atomic_snapshot(self):
        (self.root / "manifests" / "stable").mkdir(parents=True)
        self.assertTrue(self.run_sync())
        current = self.root / "manifests" / "stable"
        self.assertTrue(current.is_symlink())
        self.assertEqual(len([p for p in current.glob("*.json") if not p.name.startswith(".")]), 4)
        self.assertEqual(len(list(current.parent.glob(".stable.before-mirror-*"))), 1)
        manifest = json.loads((current / "darwin-aarch64.json").read_text())
        self.assertEqual(manifest["version"], "0.0.3")
        self.assertTrue(manifest["files"][0]["url"].endswith(".zip"))
        for item in manifest["files"]:
            body = (self.root / item["url"].lstrip("/")).read_bytes()
            self.assertEqual(item["sha512"], base64.b64encode(hashlib.sha512(body).digest()).decode())
        self.requests.clear()
        self.assertTrue(self.run_sync())
        self.assertEqual(self.requests, [])

    def test_partial_asset_upload_waits_without_publishing(self):
        self.release["assets"].pop(0)
        self.assertFalse(self.run_sync())
        self.assertFalse((self.root / "manifests").exists())

    def test_download_counts_do_not_trigger_another_publication(self):
        self.run_sync()
        current = self.root / "manifests" / "stable"
        original = current.readlink()
        self.requests.clear()
        for asset in self.release["assets"]:
            asset["download_count"] = 99
        self.run_sync()
        self.assertEqual(current.readlink(), original)
        self.assertEqual(self.requests, [])

    def test_corrupt_download_preserves_old_channel(self):
        self.run_sync()
        old = (self.root / "manifests" / "stable").readlink()
        newer = self.fixture("v0.0.4")
        name = newer["assets"][0]["name"]
        self.contents[sync.download_url(sync.REPOSITORY, "v0.0.4", newer["assets"][0])] = b"tampered"
        with self.assertRaisesRegex(ValueError, "mismatch"):
            self.run_sync(newer)
        self.assertEqual((self.root / "manifests" / "stable").readlink(), old)
        self.assertEqual(list((self.root / ".incoming").iterdir()), [])

    def test_mobile_can_arrive_later_without_redownloading_desktop(self):
        self.run_sync()
        self.requests.clear()
        release = self.fixture("v0.0.3", mobile=True)
        self.run_sync(release)
        sums = {sync.download_url(sync.REPOSITORY, "v0.0.3", a) for a in release["assets"]
                if a["name"].startswith("SHA256SUMS")}
        downloads = [u for u in self.requests if u not in sums]
        self.assertEqual(len(downloads), 2)
        state = sync.current_state(self.root / "manifests" / "stable")
        self.assertEqual(len(state["files"]), 11)

    def test_downgrade_and_draft_rejected_channels_isolated(self):
        self.run_sync()
        with self.assertRaisesRegex(ValueError, "downgrade"):
            self.run_sync(self.fixture("v0.0.2"))
        preview = self.fixture("v0.0.4-beta.1", preview=True)
        self.run_sync(preview)
        self.assertEqual(sync.current_state(self.root / "manifests" / "stable")["tag"], "v0.0.3")
        self.assertEqual(sync.current_state(self.root / "manifests" / "preview")["tag"], "v0.0.4-beta.1")
        preview["draft"] = True
        with self.assertRaisesRegex(ValueError, "Draft"):
            self.run_sync(preview)

    def test_duplicate_path_traversal_checksum_and_digest_disagreement_rejected(self):
        duplicate = deepcopy(self.release)
        duplicate["assets"].append(duplicate["assets"][0])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.run_sync(duplicate)
        for tag in ["v0.0.3/../../escape", "v0.0.3\n", "$(whoami)"]:
            with self.assertRaises(ValueError):
                sync.version_key(tag)
        sums_url = sync.download_url(sync.REPOSITORY, "v0.0.3", self.release["assets"][-1])
        original = self.contents[sums_url]
        self.contents[sums_url] = original.replace(b"CodeVori", b"../CodeVori", 1)
        sums = self.release["assets"][-1]
        sums["size"] = len(self.contents[sums_url])
        sums["digest"] = "sha256:" + hashlib.sha256(self.contents[sums_url]).hexdigest()
        with self.assertRaisesRegex(ValueError, "checksum entry"):
            self.run_sync()

    def test_missing_installer_and_manifest_are_repaired(self):
        self.run_sync()
        current = self.root / "manifests" / "stable"
        manifest = json.loads((current / "windows-x86_64.json").read_text())
        path = self.root / manifest["files"][0]["url"].lstrip("/")
        path.unlink()
        (current / "windows-x86_64.json").unlink()
        self.run_sync()
        self.assertTrue(path.exists())
        self.assertTrue((current / "windows-x86_64.json").exists())

    def test_lock_excludes_overlapping_runs(self):
        with sync.sync_lock(self.root):
            with self.assertRaises(BlockingIOError):
                with sync.sync_lock(self.root):
                    self.fail("Concurrent writer admitted")

    def test_official_asset_api_avoids_github_download_entry(self):
        for asset_id, name in [(123, "SHA256SUMS"), (456, "CodeVori-0.0.3-win-x64.exe")]:
            asset = {"id": asset_id, "name": name}
            self.assertEqual(sync.download_url(sync.REPOSITORY, "v0.0.3", asset),
                             f"https://api.github.com/repos/{sync.REPOSITORY}/releases/assets/{asset_id}")
        self.assertEqual(sync.download_url(sync.REPOSITORY, "v0.0.3", {"name": "SHA256SUMS"}),
                         sync.asset_url(sync.REPOSITORY, "v0.0.3", "SHA256SUMS"))

    def test_resumes_partial_download_and_restarts_when_server_ignores_range(self):
        asset = self.release["assets"][0]
        body = self.contents[sync.download_url(sync.REPOSITORY, "v0.0.3", asset)]
        checksum = asset["digest"][7:]
        incoming = self.root / ".incoming"
        incoming.mkdir()
        partial = incoming / f"{checksum}-{asset['name']}.part"
        class Response(io.BytesIO):
            status = 206
            def getheader(self, key, default=""):
                return f"bytes 5-{len(body) - 1}/{len(body)}"
        for status in [206, 200]:
            partial.write_bytes(body[:5])
            def response(url, headers):
                self.assertEqual(headers, {"Accept": "application/octet-stream", "Range": "bytes=5-"})
                result = Response(body[5:] if status == 206 else body)
                result.status = status
                return result
            with patch.object(sync, "open_url", response):
                info = sync.mirror_asset(self.root, sync.REPOSITORY, "v0.0.3", asset, checksum)
            destination = self.root / info["url"].lstrip("/")
            self.assertEqual(destination.read_bytes(), body)
            destination.unlink()
            self.assertFalse(partial.exists())


if __name__ == "__main__":
    unittest.main()
