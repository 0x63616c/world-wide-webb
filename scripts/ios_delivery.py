#!/usr/bin/env python3
"""Select trusted main betas or promote a recorded beta from a product tag."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

import yaml

ROOT = Path(__file__).resolve().parent.parent
TAG = re.compile(r"refs/tags/(tendr|folding)/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))")


def gh(*args):
    return subprocess.check_output(["gh", *args])


def api(path):
    return json.loads(gh("api", path))


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def tag_target(ref, source):
    match = TAG.fullmatch(ref)
    if not match:
        raise ValueError("Use tendr/vX.Y.Z or folding/vX.Y.Z")
    git("fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main", f"+{ref}:{ref}")
    if git("rev-parse", f"{ref}^{{commit}}") != source or git("merge-base", source, "origin/main") != source:
        raise ValueError("Release tag must name this exact commit on main")
    app, version = match.groups()
    config = yaml.safe_load(git("show", f"{source}:apps/{app}/app.yml"))
    if str(config["version"]) != version:
        raise ValueError("Release tag must match the app.yml version of the tested binary")
    return app, version


def trusted_ci(run, source, repo):
    if not (run["path"] == ".github/workflows/ci.yml" and run["head_sha"] == source
            and run["head_branch"] == "main" and run["event"] == "push"
            and run["status"] == "completed" and run["conclusion"] == "success"
            and run["head_repository"]["full_name"] == repo):
        raise ValueError("Successful exact-source main CI is required")


def validate_receipt(receipt, app, source, version):
    if [receipt.get(key) for key in ("app", "sha", "version")] != [app, source, version]:
        raise ValueError("Beta receipt does not match the app, source and release version")
    if not re.fullmatch(r"[1-9]\d*", str(receipt.get("build", ""))):
        raise ValueError("Beta receipt must name an exact processed build")
    if app == "folding" and not re.fullmatch(r"folding/build-[1-9]\d*", receipt.get("release_tag", "")):
        raise ValueError("Folding beta receipt must name its immutable release record")


def beta_receipt(repo, app, source, version):
    name = f"ios-beta-{app}-{source}"
    pages = json.loads(gh("api", "--paginate", "--slurp", f"repos/{repo}/actions/artifacts?name={name}&per_page=100"))
    for artifact in (item for page in pages for item in page["artifacts"]):
        if artifact["name"] != name or artifact["expired"]:
            continue
        run_id = artifact["workflow_run"]["id"]
        run = api(f"repos/{repo}/actions/runs/{run_id}")
        if not (run["path"] == ".github/workflows/release.yml" and run["event"] == "workflow_run"
                and run["status"] == "completed"
                and run["head_repository"]["full_name"] == repo):
            continue
        jobs = api(f"repos/{repo}/actions/runs/{run_id}/jobs?per_page=100")["jobs"]
        producer = [job for job in jobs if job["name"] == f"Delivery / {app.title()} / publish"]
        if len(producer) != 1 or producer[0]["status"] != "completed" or producer[0]["conclusion"] != "success":
            continue
        with tempfile.TemporaryDirectory() as directory:
            gh("run", "download", str(run_id), "--repo", repo, "--name", name, "--dir", directory)
            folder = Path(directory)
            path = folder / "beta-receipt.json"
            if list(folder.iterdir()) != [path] or path.is_symlink():
                raise ValueError("Unexpected beta receipt artifact contents")
            receipt = json.loads(path.read_text())
        validate_receipt(receipt, app, source, version)
        ci = api(f"repos/{repo}/actions/runs/{receipt['ci_run_id']}/attempts/{receipt['ci_run_attempt']}")
        trusted_ci(ci, source, repo)
        return receipt, run_id, ci
    raise ValueError(f"No successful processed TestFlight receipt for {app} at {source}; finish main delivery first")


def resolve(event_name, event, repo, ref, source):
    result = dict(tendr=False, folding=False, backend=False, receipt_run_id="", version="")
    if event_name == "workflow_run":
        ci = event["workflow_run"]
        source = ci["head_sha"]
        trusted_ci(ci, source, repo)
        with tempfile.TemporaryDirectory() as directory:
            gh("run", "download", str(ci["id"]), "--repo", repo, "--name", "repository-selection", "--dir", directory)
            selected = json.loads((Path(directory) / "ci-selection.json").read_text())
        if selected.get("head") != source or selected.get("event") != "push":
            raise ValueError("CI selection does not belong to this main revision")
        candidates = selected["delivery_candidates"]
        if not isinstance(candidates, list):
            raise ValueError("Invalid delivery selection")
        result.update(channel="beta", tendr="tendr.native" in candidates,
                      folding=bool({"folding.native", "folding.backend"}.intersection(candidates)),
                      backend="folding.backend" in candidates)
    elif event_name == "push":
        app, version = tag_target(ref, source)
        _, run_id, ci = beta_receipt(repo, app, source, version)
        result.update(channel="store", version=version, receipt_run_id=run_id)
        result[app] = True
    else:
        raise ValueError("Delivery requires successful main CI or a product release tag")
    result.update(source=source, ci_run_id=ci["id"], ci_run_attempt=ci["run_attempt"],
                  ci_run_url=f"https://github.com/{repo}/actions/runs/{ci['id']}/attempts/{ci['run_attempt']}")
    return result


def main():
    if os.environ.get("DELIVERY_OPERATION") == "recheck":
        if os.environ["CHANNEL"] == "store":
            tag_target(os.environ["GITHUB_REF"], os.environ["SOURCE_SHA"])
        return
    if os.environ.get("DELIVERY_OPERATION") == "receipt":
        path = ROOT / "build/beta-receipt.json"
        value = json.loads(path.read_text())
        value.update(ci_run_id=int(os.environ["SOURCE_CI_RUN_ID"]), ci_run_attempt=int(os.environ["SOURCE_CI_RUN_ATTEMPT"]))
        validate_receipt(value, os.environ["APP"], os.environ["SOURCE_SHA"], value["version"])
        path.write_text(json.dumps(value) + "\n")
        return
    result = resolve(os.environ["GITHUB_EVENT_NAME"], json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text()),
                     os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_REF"], os.environ["GITHUB_SHA"])
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for key, value in result.items():
            output.write(f"{key}={str(value).lower() if isinstance(value, bool) else value}\n")
    print(f"Selected {result['channel']} delivery for " + ", ".join(app for app in ("tendr", "folding") if result[app]))


if __name__ == "__main__":
    main()
