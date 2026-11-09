import unittest

from ci_image import REPOSITORY, verify


class CIImageTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.image = REPOSITORY + "@sha256:" + "b" * 64
        self.value = dict(sha=self.sha, image=self.image, os="linux", architecture="arm64")

    def test_accepts_only_an_immutable_image_for_the_tested_revision_and_platform(self):
        self.assertEqual(verify(self.value, self.sha), self.image)
        for field, bad in [
            ("sha", "c" * 40),
            ("image", REPOSITORY + ":main"),
            ("image", "ghcr.io/another/image@sha256:" + "b" * 64),
            ("image", self.image + "\nimage=untrusted"),
            ("image", None),
            ("os", "darwin"),
            ("architecture", "amd64"),
        ]:
            with self.subTest(field=field, bad=bad), self.assertRaises(ValueError):
                verify(dict(self.value, **{field: bad}), self.sha)
        for field in self.value:
            missing = dict(self.value)
            del missing[field]
            with self.subTest(missing=field), self.assertRaises(ValueError):
                verify(missing, self.sha)
        for bad in [None, [], "not an image artifact"]:
            with self.assertRaises(ValueError):
                verify(bad, self.sha)
