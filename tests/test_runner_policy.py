import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('policy', Path(__file__).parents[1] / 'scripts/runner-policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class RunnerPolicyTests(unittest.TestCase):
    def inputs(self, **changes):
        data = dict(host='homelab-macbook', guest='macos', in_flight=0,
                    free_bytes=200 * 1024 ** 3, macos_major=26,
                    tart_version='2.41.1', softnet_version='0.25.0',
                    isolation_verified=True, image='ghcr.io/example/macos@sha256:' + 'a' * 64)
        return {**data, **changes}

    def test_approved_mac_and_linux_budgets(self):
        self.assertEqual(policy.admit(**self.inputs())['memoryMiB'], 8192)
        self.assertEqual(policy.admit(**self.inputs(guest='linux'))['memoryMiB'], 6144)

    def test_ineligible_hosts_versions_state_and_images_rejected(self):
        for changes in ({'host': 'homelab-mac-mini'}, {'in_flight': 1}, {'in_flight': -1},
                        {'macos_major': 15}, {'tart_version': 'latest'}, {'softnet_version': '0.13.0'},
                        {'isolation_verified': False}, {'isolation_verified': 'true'},
                        {'image': 'ghcr.io/example/macos:latest'}, {'guest': 'windows'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                policy.admit(**self.inputs(**changes))

    def test_storage_reserve_includes_worst_case_job_growth(self):
        policy.admit(**self.inputs(free_bytes=140 * 1024 ** 3))
        with self.assertRaises(ValueError):
            policy.admit(**self.inputs(free_bytes=140 * 1024 ** 3 - 1))

    def test_launch_arguments_do_not_share_host_or_weaken_network(self):
        args = policy.run_arguments('homelab-job-' + 'a' * 32)
        self.assertIn('--net-softnet', args)
        self.assertIn('--no-clipboard', args)
        self.assertIn('--no-usb-accessories', args)
        block = next(arg for arg in args if arg.startswith('--net-softnet-block='))
        for target in ('@host', '@peers', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16'):
            self.assertIn(target, block)
        for flag in ('--dir', '--net-softnet-allow', '--net-bridged', '--nested', '--net-softnet-expose'):
            self.assertFalse(any(arg.startswith(flag) for arg in args))

    def test_external_vm_names_and_argument_injection_rejected(self):
        for name in ('base-image', '../production', '--dir=/var/lib/_containers', 'homelab-job-123'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                policy.run_arguments(name)


if __name__ == '__main__':
    unittest.main()
