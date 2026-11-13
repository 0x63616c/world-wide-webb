import unittest

from infra_apply import safe_plan


class InfraApplyTests(unittest.TestCase):
    def test_only_retired_native_public_access_may_be_deleted(self):
        for address in [
            'cloudflare_dns_record.home["app"]',
            'cloudflare_dns_record.home["api"]',
            'cloudflare_zero_trust_access_application.home["app"]',
            'cloudflare_zero_trust_access_application.home["api"]',
            "cloudflare_zero_trust_access_policy.devices[0]",
        ]:
            safe_plan({"resource_changes": [{"address": address, "change": {"actions": ["delete"]}}]})
        for resource in ['cloudflare_dns_record.home["ha"]', "cloudflare_zero_trust_tunnel_cloudflared.home"]:
            with self.assertRaises(RuntimeError):
                safe_plan({"resource_changes": [{"address": resource, "change": {"actions": ["delete", "create"]}}]})
