import unittest
from blofy_indexnow import BASE, CANONICAL_PAGES, extract_key, make_payload, pages_for_changes

class IndexNowSelectionTests(unittest.TestCase):
    def test_only_material_public_changes_submit(self):
        changed = [
            "services/activation/web/index.html",
            "services/activation/src/public-downloads.mjs",
            "services/activation/web/admin.html",
            "services/activation/web/site-polish.css",
        ]
        self.assertEqual(pages_for_changes(changed), [BASE + "/", BASE + "/downloads"])

    def test_all_manual_pages_are_canonical(self):
        self.assertEqual(pages_for_changes([], True), [BASE + p for p in CANONICAL_PAGES])

    def test_private_only_changes_do_not_submit(self):
        self.assertEqual(pages_for_changes([
            "services/activation/src/tap-payments.mjs",
            "services/activation/web/admin-login.html",
            "app/src/main/AndroidManifest.xml",
        ]), [])

    def test_release_publication_updates_downloads(self):
        self.assertEqual(pages_for_changes(["services/activation/src/approved-release-rc07555.mjs"]),
                         [BASE + "/downloads"])

    def test_unsafe_urls_cannot_be_sent(self):
        with self.assertRaises(ValueError):
            make_payload([BASE + "/api/v1/admin/devices"], "aabbccdd")
        with self.assertRaises(ValueError):
            make_payload(["https://other.example.com/"], "aabbccdd")

    def test_key_is_read_only_from_canonical_handler(self):
        self.assertEqual(extract_key("export const INDEXNOW_KEY = '0c00de98798ee0a415ae6185595bf6f0';"),
                         "0c00de98798ee0a415ae6185595bf6f0")
        with self.assertRaises(ValueError):
            extract_key("export const SOME_OTHER_KEY='missing';")

if __name__ == "__main__":
    unittest.main()
