import unittest

from check_nix import service_only


class NixScopeTests(unittest.TestCase):
    def test_service_only_builds_hosts_while_shared_inputs_keep_full_checks(self):
        self.assertTrue(service_only(["homelab/services/beszel/config.yml"]))
        for paths in [
            [],
            ["homelab/modules/operations.nix"],
            ["homelab/services/beszel/config.yml", "flake.lock"],
            ["homelab/cli/src/lib.rs"],
        ]:
            self.assertFalse(service_only(paths))
