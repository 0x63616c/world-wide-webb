import json
import os
import shutil
import sqlite3
import subprocess
import sys
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
        db.close()
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
            WWW_DOCKER_BIN=str(self.root / "bin/docker"),
            WWW_LAUNCHCTL_BIN=str(self.root / "bin/launchctl"),
        )
        launchctl = self.root / "bin/launchctl"
        launchctl.write_text(
            "#!/usr/bin/env python3\nimport os,sys\nsys.exit(1 if os.environ.get('LAUNCH_FAILURE') else 0)\n"
        )
        launchctl.chmod(0o755)
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
import json,os,sys,shutil,sqlite3
from pathlib import Path
args=sys.argv[1:]
if args[:2]==['--context','orbstack']:args=args[2:]
with open(os.environ['MINI_TEST_LOG'],'a') as log:log.write(json.dumps(args)+'\\n')
if args[0]=='run':
 if '--entrypoint' in args and args[args.index('--entrypoint')+1]=='stat':print(Path(os.environ['WWW_ROOT']+'/sqlite/control-center.sqlite').stat().st_size)
 elif args[-1]=='capabilities':print(json.dumps({'databaseCheck':True}))
 elif args[-1]=='database-check':
  try:
   db=sqlite3.connect('file:'+os.environ['WWW_ROOT']+'/sqlite/control-center.sqlite?mode=rw',uri=True)
   db.execute('PRAGMA query_only=ON')
   assert db.execute('PRAGMA quick_check').fetchall()==[('ok',)]
   db.close()
  except Exception:sys.exit(1)
 else:print('bad' if os.environ.get('IMAGE_FAILURE') else os.environ['TEST_REVISION'])
elif args[:2]==['volume','inspect']:
 print(json.dumps([{'Driver':'local','Options':None}]))
elif args[0]=='inspect' and '--format' in args:
 print('accepted-validator')
elif args[0]=='inspect':
 print(json.dumps([{'Image':'test-image','Config':{'User':'501:20'},'State':{'Running':False},'Mounts':[{'Destination':'/app/data','Type':'volume','Name':'www-control-center-sqlite'}]}]))
elif args[0]=='cp':
 if os.environ.get('COPY_FAILURE'):sys.exit(1)
 for p in Path(os.environ['WWW_ROOT']+'/sqlite').iterdir():shutil.copyfile(p,Path(args[-1])/p.name)
elif 'config' in args and '--format' in args:
 print(json.dumps({'services':{'www':{'ports':[{'host_ip':('0.0.0.0' if os.environ.get('PUBLIC_LISTENER') else '127.0.0.1'),'target':4201,'published':('4201' if os.environ.get('LEGACY_ORIGIN') else '4202')}], 'user':'501:20','image':'test-image','volumes':[{'type':'volume','source':'sqlite','target':'/app/data'}]}},'volumes':{'sqlite':{'external':True,'name':'www-control-center-sqlite'}}}))
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

    def test_unavailable_background_uploader_does_not_block_deployment(self):
        result = self.run_release(LAUNCH_FAILURE="1")
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertTrue((self.root / "current.env").exists())
        self.assertIn(b"next hourly", result.stderr)

    def test_failed_snapshot_restarts_existing_app_without_advancing_release(self):
        self.assertNotEqual(self.run_release(COPY_FAILURE="1").returncode, 0)
        self.assertIn(["start", "www-control-center-www-1"], self.calls())
        self.assertFalse((self.root / "current.env").exists())
        self.assertFalse((self.root / "generation").exists())

    def test_cold_wal_database_is_validated_and_snapshotted(self):
        (self.root / "bin/python3").symlink_to(sys.executable)
        db = sqlite3.connect(self.db)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("INSERT INTO booth_photo VALUES (135)")
        db.commit()
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        db.close()
        # Reproduce a copied import: WAL header, committed rows, no sidecars.
        for suffix in ["-wal", "-shm"]:
            Path(str(self.db) + suffix).unlink(missing_ok=True)
        self.assertFalse(Path(str(self.db) + "-wal").exists())
        result = self.run_release()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        snapshot = next((self.root / "backups").glob("*.sqlite"))
        with sqlite3.connect(snapshot) as restored:
            self.assertEqual(restored.execute("SELECT id FROM booth_photo").fetchall(), [(135,)])

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
