import importlib.util
from pathlib import Path
import sys
import unittest
from zoneinfo import ZoneInfo
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("opensky", Path(__file__).with_name("enrich-opensky.py"))
sky = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sky)


class ObservationMatchingTests(unittest.TestCase):
    def test_identity_rejects_missing_conflicting_and_unproven_alphanumeric_callsigns(self):
        f = {"airline": "Virgin Atlantic", "flight": "VS024"}
        self.assertTrue(sky.exact_identity(f, {"callsign": "VIR24", "number": ""}))
        self.assertFalse(sky.exact_identity(f, {"callsign": "VIR24M", "number": ""}))
        self.assertTrue(sky.exact_identity(f, {"callsign": "VIR24M", "number": "VS24"}))
        self.assertFalse(sky.exact_identity(f, {"callsign": "VIR24", "number": "VS23"}))
        self.assertFalse(sky.exact_identity(f | {"flight": "?"}, {"callsign": "VIR24"}))
        self.assertFalse(sky.exact_identity(f, {"callsign": "ANZ24", "number": "VS24"}))

    def test_tracking_day_uses_origin_timezone_and_never_creates_actual_clocks(self):
        row = dict(callsign="ANZ2", icao24="000000", registration="", typecode="B789",
                   firstseen="2019-03-16 00:36:48+00:00", lastseen="2019-03-16 10:21:51+00:00")
        self.assertEqual(sky.instant(row["firstseen"]).astimezone(ZoneInfo("America/Los_Angeles")).date().isoformat(), "2019-03-15")
        result = sky.observation(row, "https://example.com")
        self.assertIsNone(result["tailNumber"])
        self.assertNotIn("actualDeparture", result)
        self.assertNotIn("arrivalDelay", result)
        with self.assertRaises(ValueError):
            sky.instant("2019-03-15T10:00:00")


if __name__ == "__main__":
    unittest.main()
