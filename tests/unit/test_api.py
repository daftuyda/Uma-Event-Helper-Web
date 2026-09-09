import runpy
import shutil
import subprocess
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class BundledApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        temporary = tempfile.TemporaryDirectory()
        cls.addClassCleanup(temporary.cleanup)
        cls.bundle = Path(temporary.name).resolve()
        cls.assets = cls.bundle / "runtime-assets"
        subprocess.run(
            [
                "node",
                "-e",
                "require('./scripts/build/prepare-api-assets.js').prepareApiAssets("
                "{outputDir: process.argv[1]})",
                str(cls.assets),
            ],
            cwd=PROJECT_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        api = cls.bundle / "api" / "[...path].py"
        api.parent.mkdir()
        shutil.copy2(PROJECT_ROOT / "api" / api.name, api)
        cls.namespace = runpy.run_path(str(api))
        cls.client = cls.enterClassContext(TestClient(cls.namespace["app"]))

    def test_runtime_assets_work_without_public_directory(self):
        self.assertFalse((self.bundle / "public").exists())
        self.assertEqual(self.namespace["ASSETS"], self.assets)
        self.assertTrue((self.assets / "fonts" / "OFL.txt").is_file())

    def test_all_og_pages_and_route_aliases(self):
        for page in self.namespace["OG_PAGES"]:
            image_bytes = None
            for target in (
                f"/api/og?page={page}",
                f"/api/og/{page}.png",
                f"/api/og/v1/{page}.png",
            ):
                with self.subTest(target=target):
                    response = self.client.get(target)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["content-type"], "image/png")
                    self.assertIn("s-maxage=604800", response.headers["cache-control"])
                    self.assertGreater(len(response.content), 10 * 1024)
                    with Image.open(BytesIO(response.content)) as image:
                        self.assertEqual(image.format, "PNG")
                        self.assertEqual(image.size, (1200, 630))
                        image.verify()
                    if image_bytes is None:
                        image_bytes = response.content
                    self.assertEqual(response.content, image_bytes)
                    head = self.client.head(target)
                    self.assertEqual(head.status_code, 200)
                    self.assertEqual(head.headers["content-type"], "image/png")
                    self.assertEqual(int(head.headers["content-length"]), len(image_bytes))
                    self.assertEqual(head.content, b"")

    def test_unknown_og_page_is_not_a_server_error(self):
        for target in (
            "/api/og?page=unknown-page",
            "/api/og/unknown-page.png",
            "/api/og/v1/unknown-page.png",
        ):
            for method in (self.client.get, self.client.head):
                with self.subTest(target=target, method=method.__name__):
                    self.assertEqual(method(target).status_code, 404)

    def test_event_data_is_available_in_the_bundle(self):
        response = self.client.get("/api/events")
        self.assertEqual(response.status_code, 200)
        events = response.json()["events"]
        self.assertGreater(len(events), 0)
        match = self.client.get("/api/event_by_name", params={"event_name": events[0]})
        self.assertEqual(match.status_code, 200)
        self.assertEqual(match.json()["match"]["event_name"], events[0])
        self.assertEqual(match.json()["match"]["score"], 100)


if __name__ == "__main__":
    unittest.main()
