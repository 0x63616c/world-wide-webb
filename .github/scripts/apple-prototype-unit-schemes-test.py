import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("schemes", Path(__file__).with_name("apple-prototype-unit-schemes.py"))
schemes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schemes)


class SchemeTests(unittest.TestCase):
    def test_removes_only_unexecuted_bundles(self):
        for target, other in [("PanelTests", "WorldWideWebbTests"), ("WorldWideWebbTests", "WorldWideWebbUITests")]:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "Test.xcscheme"
                path.write_text(f'''<Scheme><BuildAction marker="keep"/><TestAction codeCoverageEnabled="YES"><Testables>
<TestableReference skipped="NO"><BuildableReference BlueprintName="{target}"/></TestableReference>
<TestableReference skipped="NO"><BuildableReference BlueprintName="{other}"/></TestableReference>
</Testables></TestAction></Scheme>''')
                schemes.restrict_scheme(path, target)
                root = ET.parse(path).getroot()
                self.assertEqual(root.find("BuildAction").get("marker"), "keep")
                self.assertEqual(root.find("TestAction").get("codeCoverageEnabled"), "YES")
                testables = root.findall("TestAction/Testables/TestableReference")
                self.assertEqual(len(testables), 1)
                self.assertEqual(testables[0].find("BuildableReference").get("BlueprintName"), target)
                self.assertEqual(testables[0].get("skipped"), "NO")

    def test_missing_or_duplicate_unit_bundle_fails(self):
        for content in ['<Scheme/>', '<Scheme><TestAction><Testables/></TestAction></Scheme>', '<Scheme><TestAction><Testables>' + '<TestableReference><BuildableReference BlueprintName="PanelTests"/></TestableReference>' * 2 + '</Testables></TestAction></Scheme>']:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "Test.xcscheme"
                path.write_text(content)
                with self.assertRaises(ValueError):
                    schemes.restrict_scheme(path, "PanelTests")
                self.assertEqual(path.read_text(), content)


if __name__ == "__main__":
    unittest.main()
