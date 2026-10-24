from copy import deepcopy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("node_sync", Path(__file__).with_name("sync-device-node.py"))
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class Response(io.BytesIO):
    status = 200

    def getheader(self, key, default=""):
        return default


class NodeMirrorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bodies = {}
        self.release = self.fixture()
        self.requests = []
        self.patcher = patch.object(sync.mirror, "open_url", self.open_url)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        sleeper = patch.object(sync.mirror.time, "sleep")
        sleeper.start()
        self.addCleanup(sleeper.stop)

    def fixture(self, version="0.0.7", source="a" * 40, payload="binary"):
        assets = []
        files = []
        def add(name, body):
            asset = {"id": len(self.bodies) + 1, "name": name, "size": len(body),
                     "digest": "sha256:" + hashlib.sha256(body).hexdigest()}
            assets.append(asset)
            self.bodies[sync.mirror.download_url(sync.mirror.REPOSITORY, "v0.0.5", asset)] = body
            return asset
        for platform, name in sync.CLIENTS.items():
            a = add(name, (payload + name).encode())
            files.append({"platform": platform, "name": name, "bytes": a["size"], "sha256": a["digest"][7:],
                          "url": f"{sync.ASSETS_URL}/{version}/{name}"})
        add("CodeVoriNode-LICENSE.txt", b"license")
        manifest = {"version": version, "source": source, "dirty": False,
                    "serviceUrl": sync.SERVICE_URL, "files": files}
        add("device-node-manifest.json", json.dumps(manifest).encode())
        add("SHA256SUMS-device-node", "".join(f"{a['digest'][7:]}  {a['name']}\n" for a in assets).encode())
        return {"tag_name": "v0.0.5", "draft": False, "prerelease": False, "assets": assets}

    def open_url(self, url, headers=None):
        self.requests.append(url)
        return Response(self.bodies[url])

    def run_sync(self, release=None):
        return sync.sync_release(self.root, sync.mirror.REPOSITORY, release or self.release)

    def test_complete_publication_shared_pointer_and_idempotency(self):
        self.assertTrue(self.run_sync())
        clients = self.root / "clients"
        self.assertEqual((clients / "current").readlink(), Path("0.0.7"))
        self.assertEqual((clients / "latest.json").readlink(), Path("current/manifest.json"))
        self.assertEqual(json.loads((clients / "latest.json").read_text())["version"], "0.0.7")
        for name in sync.CLIENTS.values():
            self.assertTrue((clients / "current" / name).is_file())
        original = (clients / "latest.json").read_bytes()
        self.requests.clear()
        self.run_sync()
        self.assertEqual(self.requests, [])
        self.run_sync(self.fixture(source="b" * 40))
        self.assertEqual((clients / "latest.json").read_bytes(), original)

    def test_migrates_existing_manual_publication_without_breaking_links(self):
        self.run_sync()
        latest = self.root / "clients/latest.json"
        content = latest.read_bytes()
        latest.unlink()
        latest.write_bytes(content)
        self.run_sync(self.fixture("0.0.8"))
        self.assertTrue(latest.is_symlink())
        self.assertEqual(json.loads(latest.read_text())["version"], "0.0.8")

    def test_missing_asset_and_preview_never_publish(self):
        for key in ("draft", "prerelease"):
            release = deepcopy(self.release)
            release[key] = True
            self.assertFalse(self.run_sync(release))
        self.release["assets"].pop(0)
        self.assertFalse(self.run_sync())
        self.assertFalse((self.root / "clients/current").exists())

    def test_corrupt_payload_preserves_both_pointers(self):
        self.run_sync()
        release = self.fixture("0.0.8", payload="new binary")
        asset = release["assets"][0]
        self.bodies[sync.mirror.download_url(sync.mirror.REPOSITORY, "v0.0.5", asset)] = b"x" * asset["size"]
        with self.assertRaisesRegex(OSError, "checksum mismatch"):
            self.run_sync(release)
        self.assertEqual(json.loads((self.root / "clients/latest.json").read_text())["version"], "0.0.7")
        self.assertEqual((self.root / "clients/current").readlink(), Path("0.0.7"))

    def test_rejects_downgrade_and_same_version_payload_change(self):
        self.run_sync()
        with self.assertRaisesRegex(ValueError, "downgrade"):
            self.run_sync(self.fixture("0.0.6"))
        with self.assertRaisesRegex(ValueError, "Immutable"):
            self.run_sync(self.fixture(payload="changed"))
        self.assertEqual((self.root / "clients/current").readlink(), Path("0.0.7"))

    def test_manifest_rejects_wrong_origin_path_hash_dirty_and_duplicates(self):
        _, valid = sync.fetch_manifest(sync.mirror.REPOSITORY, self.release)
        mutations = [lambda m: m.update(dirty=True), lambda m: m.update(version="../escape"),
                     lambda m: m.update(serviceUrl="https://evil.test/nodes"),
                     lambda m: m["files"][0].update(url="https://evil.test/client"),
                     lambda m: m["files"][0].update(name="../escape"),
                     lambda m: m["files"][0].update(sha256="invalid"),
                     lambda m: m["files"].__setitem__(0, m["files"][1])]
        for mutate in mutations:
            manifest = deepcopy(valid)
            mutate(manifest)
            with self.assertRaises(ValueError):
                sync.validate_manifest(manifest, sync.SERVICE_URL, sync.ASSETS_URL)

    def test_already_published_payload_is_rechecked(self):
        self.run_sync()
        path = self.root / "clients/current" / next(iter(sync.CLIENTS.values()))
        path.write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "integrity"):
            self.run_sync()

    def test_concurrent_runs_excluded(self):
        with sync.mirror.sync_lock(self.root):
            with self.assertRaises(BlockingIOError):
                with sync.mirror.sync_lock(self.root):
                    self.fail("second publisher admitted")


if __name__ == "__main__":
    unittest.main()
