import unittest

from tailscale_serve import HOST, ORIGIN, unrelated, validate


class TailscaleServeTests(unittest.TestCase):
    def test_public_funnel_wrong_node_and_existing_service_are_rejected(self):
        for config, host in [
            ({"AllowFunnel": {HOST + ":443": True}}, HOST),
            ({}, "another-node.example"),
            ({"Web": {HOST + ":443": {"Handlers": {"/": {"Proxy": "http://localhost:9999"}}}}}, HOST),
            ({"TCP": {"443": {"TCPForward": "localhost:9999"}}}, HOST),
        ]:
            with self.assertRaises(RuntimeError):
                validate(config, host)

    def test_only_the_owned_route_is_ignored_when_checking_other_services(self):
        original = {
            "TCP": {"8000": {"HTTPS": True}},
            "Web": {HOST + ":8000": {"Handlers": {"/": {"Proxy": "http://localhost:8000"}}}},
        }
        changed = dict(original, Web=dict(original["Web"], **{HOST + ":443": {"Handlers": {"/": {"Proxy": ORIGIN}}}}))
        validate(changed, HOST + ".")
        self.assertEqual(unrelated(original), unrelated(changed))
        changed["TCP"] = {"8000": {"HTTPS": False}}
        self.assertNotEqual(unrelated(original), unrelated(changed))
