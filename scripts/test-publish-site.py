#!/usr/bin/env python3
"""Exercise real site publication against a throwaway local origin, without network."""
from pathlib import Path
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
    write("site/.retain", "# Keep retired apps\n\noldapp\nretired\nsamplr\nmissing")
    write("site/.legacy-root", "samplr\n")
    write("site/README.md", "Private publishing instructions\n")
    write("site/samplr/index.html", "New Samplr\n")
    write("site/samplr/privacy/index.html", "New privacy\n")
    git("add", ".")
    git("commit", "-qm", "Source fixture")
    git("push", "-q", "origin", "main")

    git("checkout", "-qb", "gh-pages")
    git("rm", "-rq", ".")
    for app in ["oldapp", "retired", "samplr", "obsolete"]:
        write(f"{app}/index.html", f"Old {app}\n")
        write(f"{app}/support/index.html", f"Old {app} support\n")
    git("add", ".")
    git("commit", "-qm", "Published fixture")
    git("push", "-q", "origin", "gh-pages")
    git("checkout", "-q", "main")

    def publish():
        return subprocess.check_output(
            ["bash", "scripts/publish-site.sh"], cwd=root, text=True
        )

    def published(path):
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
    assert not {".retain", ".legacy-root", "README.md"}.intersection(files)
    assert ".nojekyll" in files
    assert "[skip ci]" in git("log", "-1", "--format=%s", "origin/gh-pages")

    head = git("rev-parse", "origin/gh-pages")
    assert "gh-pages already up to date" in publish()
    assert git("rev-parse", "origin/gh-pages") == head
    assert git("status", "--porcelain") == ""

    # Removing the opt-in file permits previously retained pages to disappear.
    (root / "site/.retain").unlink()
    git("add", ".")
    git("commit", "-qm", "Remove retention fixture")
    assert "Published site" in publish()
    assert git("ls-tree", "--name-only", "origin/gh-pages", "oldapp", "retired") == ""

print("Site publication checks passed (retention, build priority, removal, legacy root, no-op).")
