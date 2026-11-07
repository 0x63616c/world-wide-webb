import unittest
from infra_apply import safe_plan

class InfraApplyTests(unittest.TestCase):
    def test_only_the_explicitly_retired_app_hostname_may_be_deleted(self):
        safe_plan({'resource_changes':[{'address':'cloudflare_dns_record.home["app"]','change':{'actions':['delete']}}]})
        safe_plan({'resource_changes':[{'address':'cloudflare_dns_record.home["api"]','change':{'actions':['update']}}]})
        for resource in ['cloudflare_dns_record.home["ha"]','cloudflare_zero_trust_tunnel_cloudflared.home']:
            with self.assertRaises(RuntimeError):
                safe_plan({'resource_changes':[{'address':resource,'change':{'actions':['delete','create']}}]})
