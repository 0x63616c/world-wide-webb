import csv
import importlib.util
import io
from pathlib import Path
import tempfile
import sys
sys.dont_write_bytecode = True
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("enrich", Path(__file__).with_name("enrich-bts.py"))
enrich = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrich)


class BTSMatchingTests(unittest.TestCase):
    def row(self, **changes):
        row = dict(FlightDate="2024-01-02", IATA_Code_Marketing_Airline="UA",
                   Flight_Number_Marketing_Airline="123", Origin="LAX", Dest="SFO",
                   IATA_Code_Operating_Airline="OO", Flight_Number_Operating_Airline="456",
                   Tail_Number="N000EX", CRSDepTime="2350", DepTime="2400", CRSArrTime="0100",
                   ArrTime="0052", DepDelay="10.00", ArrDelay="-8.00", ActualElapsedTime="52.00",
                   AirTime="40.00", Cancelled="0.00", Diverted="0.00")
        return row | changes

    def test_identity_rejects_unknown_and_conflicting_carrier(self):
        flight = dict(date="2024-01-02", airline="United", flight="UA00123", **{"from": "LAX", "to": "SFO"})
        self.assertEqual(enrich.identity(flight), ("2024-01-02", "UA", "123", "LAX", "SFO"))
        self.assertIsNone(enrich.identity(flight | {"flight": "?"}))
        self.assertIsNone(enrich.identity(flight | {"airline": "Delta"}))
        self.assertIsNone(enrich.identity(flight | {"airline": "United/Delta"}))

    def test_times_signed_delays_and_missing_values(self):
        data = enrich.operation(self.row(), "https://example.com")
        self.assertEqual(data["actualDeparture"], "24:00")
        self.assertEqual(data["actualArrival"], "00:52")
        self.assertEqual(data["arrivalDelay"], -8)
        self.assertEqual(data["operatingCarrier"], "OO")
        self.assertIsNone(enrich.operation(self.row(Tail_Number="", AirTime=""), "x")["tailNumber"])
        with self.assertRaises(ValueError):
            enrich.clock("2461")

    def test_cancelled_and_diverted_never_claim_destination_arrival(self):
        for flags in [{"Cancelled": "1.00"}, {"Diverted": "1.00"}]:
            data = enrich.operation(self.row(**flags), "x")
            self.assertIsNone(data["actualArrival"])
            self.assertIsNone(data["arrivalDelay"])
            self.assertIsNone(data["elapsedMinutes"])

    def test_exact_key_and_duplicate_rows(self):
        target = ("2024-01-02", "UA", "123", "LAX", "SFO")
        for duplicate in [False, True]:
            rows = [self.row(), self.row(FlightDate="2024-01-03"), self.row(Dest="SEA")]
            if duplicate:
                rows.append(self.row())
            stream = io.StringIO()
            writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
            writer.writeheader(); writer.writerows(rows)
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / "month.zip"
                with zipfile.ZipFile(path, "w") as archive:
                    archive.writestr("month.csv", stream.getvalue())
                matched, ambiguous = enrich.match_archive(path, {target}, "x")
            self.assertEqual(target in matched, not duplicate)
            self.assertEqual(target in ambiguous, duplicate)


if __name__ == "__main__":
    unittest.main()
