#!/usr/bin/env python3
"""Check public asset isolation and the real Cloudflare publisher without network."""

from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="publish-site-") as directory:
    base = Path(directory).resolve()
    root = base / "repo"
    (root / "scripts").mkdir(parents=True)
    for script in ["build-site.sh", "publish-site.sh"]:
        shutil.copy2(ROOT / "scripts" / script, root / "scripts" / script)
    (root / "sites").mkdir()
    for name in ["tendr-tools.json", "tendr.wrangler.jsonc"]:
        shutil.copy2(ROOT / "sites" / name, root / "sites" / name)
    (root / "sites/.pages").write_text("tendr\n")
    (root / "sites/tendr/privacy").mkdir(parents=True)
    (root / "sites/tendr/support").mkdir()
    for path in ["index.html", "privacy/index.html", "support/index.html"]:
        (root / "sites/tendr" / path).write_text(path)
    (root / "sites/folding").mkdir()
    (root / "sites/folding/worker.js").write_text("must never publish")
    (root / "sites/README.md").write_text("private instructions")
    artifact = base / "verified"
    subprocess.run(["bash", "scripts/build-site.sh", str(artifact)], cwd=root, check=True)
    assert not (artifact / "folding").exists()
    assert not (artifact / "README.md").exists()
    binary = base / "bin"
    binary.mkdir()
    invocation = base / "invocation.json"
    fake = binary / "bunx"
    fake.write_text(
        "#!/usr/bin/env python3\nimport json,os,sys\n"
        "json.dump(sys.argv[1:],open(os.environ['INVOCATION'],'w'))\n"
        "sys.exit(int(os.environ.get('DEPLOY_EXIT','0')))\n"
    )
    fake.chmod(0o755)
    env = dict(
        os.environ,
        PATH=str(binary) + os.pathsep + os.environ["PATH"],
        CLOUDFLARE_API_TOKEN="fixture-only",
        CLOUDFLARE_ACCOUNT_ID="fixture-only",
        INVOCATION=str(invocation),
    )

    def publish(**changes):
        invocation.unlink(missing_ok=True)
        return subprocess.run(
            ["bash", "scripts/publish-site.sh", str(artifact)],
            cwd=root,
            env=dict(env, **changes),
            capture_output=True,
            text=True,
        )

    assert publish().returncode == 0
    args = json.loads(invocation.read_text())
    assert args == [
        "wrangler@" + json.loads((root / "sites/tendr-tools.json").read_text())["wrangler"],
        "deploy",
        "--config",
        str(root / "sites/tendr.wrangler.jsonc"),
        "--assets",
        str(artifact / "tendr"),
    ]
    assert publish(DEPLOY_EXIT="1").returncode != 0, "Deployment failure must propagate"
    assert publish(CLOUDFLARE_API_TOKEN="").returncode != 0
    assert not invocation.exists()
    (artifact / "private.yaml").write_text("unexpected")
    result = publish()
    assert result.returncode != 0 and "differs" in result.stderr
    assert not invocation.exists()
    (artifact / "private.yaml").unlink()
    (artifact / "tendr/privacy/index.html").unlink()
    assert publish().returncode != 0 and not invocation.exists()
    (root / "sites/tendr/README.md").write_text("private")
    result = subprocess.run(
        ["bash", "scripts/build-site.sh", str(base / "unsafe")], cwd=root, capture_output=True, text=True
    )
    assert result.returncode != 0 and "nonpublic" in result.stderr
    (root / "sites/tendr/README.md").unlink()
    (root / "sites/tendr/private.txt").symlink_to(root / "sites/README.md")
    result = subprocess.run(
        ["bash", "scripts/build-site.sh", str(base / "symlink")], cwd=root, capture_output=True, text=True
    )
    assert result.returncode != 0 and "regular" in result.stderr

print("PASS: public asset isolation, verified artifact, Tendr-only upload and failure propagation")
