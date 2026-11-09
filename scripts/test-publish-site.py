#!/usr/bin/env python3
"""Exercise real site publication against a throwaway local origin, without network."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent

with tempfile.TemporaryDirectory(prefix="publish-site-") as directory:
    base = Path(directory)
    origin = base / "origin.git"
    root = base / "repo"
    root.mkdir()

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    def write(path, content):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    git("init", "--bare", "-q", str(origin))
    git("init", "-q", "-b", "main")
    git("config", "user.name", "Calum")
    git("config", "user.email", "6991398+0x63616c@users.noreply.github.com")
    git("remote", "add", "origin", str(origin))
    (root / "scripts").mkdir()
    for script in ["build-site.sh", "publish-site.sh"]:
        shutil.copy2(ROOT / "scripts" / script, root / "scripts" / script)
    write("sites/.pages", "samplr\n")
    write("sites/folding/build.mjs", "Private build machinery must not be published\n")
    write("sites/folding/README.md", "Private source docs\n")
    write("sites/.retain", "# Keep retired apps\n\noldapp\nretired\nsamplr\nmissing")
    write("sites/.legacy-root", "samplr\n")
    write("sites/README.md", "Private publishing instructions\n")
    write("sites/samplr/index.html", "New Samplr\n")
    write("sites/samplr/privacy/index.html", "New privacy\n")
    git("add", ".")
    git("commit", "-qm", "Source fixture")
    git("push", "-q", "origin", "main")
    first_source = git("rev-parse", "HEAD")

    git("checkout", "-qb", "gh-pages")
    git("rm", "-rq", ".")
    for app in ["oldapp", "retired", "samplr", "obsolete"]:
        write(f"{app}/index.html", f"Old {app}\n")
        write(f"{app}/support/index.html", f"Old {app} support\n")
    git("add", ".")
    git("commit", "-qm", "Published fixture")
    git("push", "-q", "origin", "gh-pages")
    git("checkout", "-q", "main")

    target = base / "pages"
    git("clone", "-q", "--single-branch", "--branch", "gh-pages", str(origin), str(target))
    subprocess.check_call(["git", "config", "user.name", "Fixture publisher"], cwd=target)
    subprocess.check_call(["git", "config", "user.email", "fixture@example.invalid"], cwd=target)

    def publish(prepared=None):
        return subprocess.check_output(
            ["bash", "scripts/publish-site.sh", str(target), *([str(prepared)] if prepared else [])], cwd=root, text=True,
            env=dict(os.environ, SITE_PUBLISH_REMOTE=str(origin))
        )

    def published(path):
        git("fetch", "-q", "origin", "gh-pages")
        return git("show", f"origin/gh-pages:{path}")

    assert "Published site" in publish()
    for app in ["oldapp", "retired"]:
        assert published(f"{app}/index.html") == f"Old {app}"
        assert published(f"{app}/support/index.html") == f"Old {app} support"
    assert published("samplr/index.html") == "New Samplr"
    assert published("samplr/privacy/index.html") == "New privacy"
    assert published("index.html") == "New Samplr", "Legacy root must still mirror"
    assert published("privacy/index.html") == "New privacy"
    files = git("ls-tree", "-r", "--name-only", "origin/gh-pages").splitlines()
    assert not any(path.startswith(("obsolete/", "missing/", "samplr/support/")) for path in files)
    assert not {".retain", ".legacy-root", ".pages", "README.md"}.intersection(files)
    assert not any(name.startswith("folding/") for name in files), "Worker source must remain private"
    assert ".nojekyll" in files
    assert "[skip ci]" in git("log", "-1", "--format=%s", "origin/gh-pages")

    head = git("rev-parse", "origin/gh-pages")
    assert "gh-pages already up to date" in publish()
    assert git("rev-parse", "origin/gh-pages") == head
    assert git("status", "--porcelain") == ""

    prepared = base / "tested-public-site"
    subprocess.check_call(["bash", "scripts/build-site.sh", str(prepared)], cwd=root)
    assert "gh-pages already up to date" in publish(prepared)
    (prepared / "private.yaml").write_text("must not publish")
    result = subprocess.run(["bash", "scripts/publish-site.sh", str(target), str(prepared)], cwd=root,
                            env=dict(os.environ, SITE_PUBLISH_REMOTE=str(origin)), capture_output=True, text=True)
    assert result.returncode != 0 and "differs" in result.stderr
    assert subprocess.check_output(["git", "status", "--porcelain"], cwd=target, text=True).strip() == ""

    # An unreviewed private file inside an explicitly public root fails closed.
    write("sites/samplr/README.md", "Private instructions")
    result = subprocess.run(["bash", "scripts/build-site.sh", str(base / "unsafe-preview")], cwd=root,
                            capture_output=True, text=True)
    assert result.returncode != 0 and "nonpublic" in result.stderr
    (root / "sites/samplr/README.md").unlink()

    # Removing the opt-in file permits previously retained pages to disappear.
    (root / "sites/.retain").unlink()
    git("add", ".")
    git("commit", "-qm", "Remove retention fixture")
    assert "Published site" in publish()
    git("fetch", "-q", "origin", "gh-pages")
    assert git("ls-tree", "--name-only", "origin/gh-pages", "oldapp", "retired") == ""

    # A delayed older source cannot replace a newer published site.
    write("sites/samplr/index.html", "Newest Samplr\n")
    git("add", ".")
    git("commit", "-qm", "Newest public source")
    assert "Published site" in publish()
    latest = published("samplr/index.html")
    git("checkout", "-q", "--detach", first_source)
    assert "Newer public site already published" in publish()
    assert published("samplr/index.html") == latest


    git("checkout", "-q", "main")
    write("sites/samplr/index.html", "Intermediate Samplr\n")
    git("add", ".")
    git("commit", "-qm", "Intermediate public source")
    intermediate = git("rev-parse", "HEAD")
    write("sites/samplr/index.html", "Newest Samplr\n")
    git("add", ".")
    git("commit", "-qm", "Restore same public output at newer source")
    assert "Published site" in publish(), "Identical newer output must still advance source authority"
    git("checkout", "-q", "--detach", intermediate)
    assert "Newer public site already published" in publish()
    assert published("samplr/index.html") == "Newest Samplr"


    # A failed push leaves a private local commit, never a confirmed remote publication.
    git("checkout", "-q", "main")
    write("sites/samplr/index.html", "Unpublished candidate\n")
    git("add", ".")
    git("commit", "-qm", "Candidate whose push fails")
    rejection = origin / "hooks/pre-receive"
    rejection.write_text("#!/bin/sh\nexit 1\n")
    rejection.chmod(0o755)
    command = ["bash", "scripts/publish-site.sh", str(target)]
    environment = dict(os.environ, SITE_PUBLISH_REMOTE=str(origin))
    failed = subprocess.run(command, cwd=root, env=environment, capture_output=True, text=True)
    assert failed.returncode != 0
    retried = subprocess.run(command, cwd=root, env=environment, capture_output=True, text=True)
    assert retried.returncode != 0 and "fresh clean Pages checkout" in retried.stderr
    assert published("samplr/index.html") == "Newest Samplr"


print("Site publication checks passed (retention, build priority, removal, legacy root, no-op).")
