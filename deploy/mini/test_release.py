import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IMAGE = "ghcr.io/0x63616c/www-control-center-mini@sha256:" + "1" * 64
REVISION = "2" * 40


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        (self.root / "bin").mkdir()
        (self.root / "sqlite").mkdir()
        self.db = self.root / "sqlite/control-center.sqlite"
        with sqlite3.connect(self.db) as db:
            for table in ["settings", "booth_photo", "walk", "_sqlx_migrations"]:
                db.execute(f'CREATE TABLE "{table}"(id INTEGER)')
        for name in ["sqlite_preflight.py", "sqlite_snapshot.py", "tailscale_serve.py"]:
            shutil.copyfile(ROOT / name, self.root / name)
        (self.root / "runtime.env").touch()
        (self.root / "compose.yaml").touch()
        self.env = dict(
            os.environ,
            WWW_ROOT=str(self.root),
            MINI_TEST_LOG=str(self.root / "calls"),
            PATH=str(self.root / "bin") + ":" + os.environ["PATH"],
            TEST_REVISION=REVISION,
        )
        tailnet = self.root / "bin/tailscale"
        tailnet.write_text("""#!/usr/bin/env python3
import json,sys
if sys.argv[1] == 'status':print(json.dumps({'Self':{'DNSName':'homelab.tail8c014d.ts.net.'}}))
elif 'status' in sys.argv:print(json.dumps({'TCP':{'443':{'HTTPS':True}},'Web':{'homelab.tail8c014d.ts.net:443':{'Handlers':{'/':{'Proxy':'http://127.0.0.1:4202'}}}}}))
""")
        tailnet.chmod(0o755)
        self.env["WWW_TAILSCALE_BIN"] = str(tailnet)
        docker = self.root / "bin/docker"
        docker.write_text("""#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['MINI_TEST_LOG'],'a') as log:log.write(json.dumps(args)+'\\n')
if args[0]=='run':
 print('bad' if os.environ.get('IMAGE_FAILURE') else os.environ['TEST_REVISION'])
elif 'config' in args and '--format' in args:
 print(json.dumps({'services':{'www':{'ports':[{'host_ip':('0.0.0.0' if os.environ.get('PUBLIC_LISTENER') else '127.0.0.1'),'target':4201,'published':('4201' if os.environ.get('LEGACY_ORIGIN') else '4202')}], 'volumes':[{'type':'bind','source':os.environ['WWW_ROOT']+'/sqlite','target':'/app/data'}]}}}))
elif 'exec' in args and os.environ.get('HEALTH_FAILURE'):sys.exit(1)
""")
        docker.chmod(0o755)

    def run_release(self, generation=1, **extra):
        return subprocess.run(
            ["bash", str(ROOT / "release.sh"), IMAGE, REVISION, str(generation)],
            env=dict(self.env, **extra),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def calls(self):
        return [json.loads(line) for line in (self.root / "calls").read_text().splitlines()]

    def test_missing_database_or_wrong_image_never_stops_working_app(self):
        result = self.run_release(IMAGE_FAILURE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("stop" in call for call in self.calls()))
        self.assertNotEqual(self.run_release(PUBLIC_LISTENER="1").returncode, 0)
        self.assertFalse(any("stop" in call for call in self.calls()))
        self.assertNotEqual(self.run_release(LEGACY_ORIGIN="1").returncode, 0)
        self.assertFalse(any("stop" in call for call in self.calls()))
        self.db.unlink()
        self.assertNotEqual(self.run_release().returncode, 0)
        self.assertFalse(any("stop" in call for call in self.calls()))

    def test_backup_revision_and_generation_are_verified_before_advancing_pointer(self):
        self.assertEqual(self.run_release().returncode, 0)
        self.assertEqual((self.root / "generation").read_text().strip(), "1")
        snapshots = list((self.root / "backups").glob("*.sqlite"))
        self.assertEqual(len(snapshots), 1)
        with sqlite3.connect(snapshots[0]) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
        before = (self.root / "current.env").read_bytes()
        self.assertNotEqual(self.run_release(2, HEALTH_FAILURE="1").returncode, 0)
        self.assertEqual((self.root / "current.env").read_bytes(), before)
        self.assertEqual((self.root / "generation").read_text().strip(), "1")
        self.assertEqual(self.run_release(2).returncode, 0)  # retry must not overwrite/refuse its earlier backup
        count = len(self.calls())
        self.assertEqual(self.run_release(1).returncode, 0)
        self.assertEqual(len(self.calls()), count)
        self.assertFalse((self.root / "deploy.lock").exists())

    def test_recovery_preserves_highest_ci_generation(self):
        self.assertEqual(self.run_release(42).returncode, 0)
        shutil.copyfile(self.root / "current.env", self.root / "previous.env")
        result = subprocess.run(
            ["bash", str(ROOT / "recover.sh"), "previous", REVISION, "--database-compatible"],
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual((self.root / "generation").read_text().strip(), "42")
        self.assertEqual(len(list((self.root / "backups").glob("before-recovery-*.sqlite"))), 1)
        self.assertFalse((self.root / "deploy.lock").exists())


if __name__ == "__main__":
    unittest.main()
