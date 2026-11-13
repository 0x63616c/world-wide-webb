#!/usr/bin/env python3
"""Validate exact Homelab CI evidence, then enqueue or atomically promote source."""

import importlib.util
import json
import os
import subprocess
import tempfile
from pathlib import Path

from promotion import REPOSITORY, Conflict, Store, promote, sha, validate_intent

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("host_inputs", ROOT / "scripts/ci/input_hash.py")
inputs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inputs)


def gh(*args):
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("GitHub evidence could not be confirmed; no deployment authorized")
    return result.stdout


def api(path):
    return json.loads(gh("api", f"repos/{REPOSITORY}/{path}"))


def source_document(source, name):
    result = subprocess.run(
        ["git", "show", source + ":" + name],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError("Committed host policy could not be read")
    return json.loads(result.stdout)


def source_configuration(source):
    return source_document(source, "scripts/ci/units.json")


def source_manifest(source):
    return source_document(source, "projects/homelab/homelab.json")


def load_selection(run_id):
    with tempfile.TemporaryDirectory(prefix="homelab-source-evidence-") as directory:
        gh("run", "download", str(run_id), "--repo", REPOSITORY, "--name", "repository-selection", "--dir", directory)
        return json.loads((Path(directory) / "ci-selection.json").read_text())


def validate_ci(intent, run, jobs, allow_manual=False, checks=None):
    validate_intent(intent)
    if (
        run.get("id") != intent["run_id"]
        or run.get("run_attempt") != intent["attempt"]
        or run.get("head_sha") != intent["source"]
        or run.get("head_branch") != "main"
        or run.get("head_repository", {}).get("full_name") != REPOSITORY
        or run.get("path", "").split("@", 1)[0] != ".github/workflows/ci.yml"
        or run.get("event") not in (("push", "workflow_dispatch") if allow_manual else ("push",))
        or run.get("status") != "completed"
        or run.get("conclusion") != "success"
    ):
        raise ValueError("CI source, attempt or trust context differs")
    if checks is not None and (not isinstance(checks, list) or "homelab.darwin" not in checks):
        raise ValueError("Host delivery requires its selected Darwin verification")
    expected = dict.fromkeys(
        ("Homelab / Homelab selection", "Homelab / Homelab Darwin configuration", "Homelab / Homelab checks"), "success"
    )
    for name, check in (
        ("Homelab / Homelab operations", "homelab.operations"),
        ("Homelab / Homelab Linux controller", "homelab.linux"),
        ("Homelab / Homelab CLI", "homelab.cli"),
    ):
        if checks is not None:
            expected[name] = "success" if check in checks else "skipped"
        elif check != "homelab.cli":
            expected[name] = "success"
    for name, conclusion in expected.items():
        matches = [job for job in jobs if job.get("name") == name]
        if len(matches) != 1 or matches[0].get("status") != "completed" or matches[0].get("conclusion") != conclusion:
            raise ValueError("Selected host checks did not all succeed")


def verify(intent, selection=None, allow_manual=False):
    run = api(f"actions/runs/{intent['run_id']}/attempts/{intent['attempt']}")
    jobs = []
    for page in range(1, 11):
        batch = api(f"actions/runs/{intent['run_id']}/attempts/{intent['attempt']}/jobs?per_page=100&page={page}")[
            "jobs"
        ]
        jobs += batch
        if len(batch) < 100:
            break
    else:
        raise ValueError("CI job inventory exceeds its bound")
    selection = selection if selection is not None else load_selection(intent["run_id"])
    if selection.get("head") != intent["source"] or selection.get("event") != "push":
        raise ValueError("Selection artifact has a different source/context")
    validate_ci(intent, run, jobs, allow_manual, selection.get("checks"))
    if selection is not None:
        if (
            selection.get("head") != intent["source"]
            or selection.get("event") != "push"
            or (not allow_manual and "homelab.config" not in selection.get("delivery_candidates", []))
        ):
            raise ValueError("CI did not select host delivery for this source")
    source = intent["source"]
    manifest = source_manifest(source)
    if manifest.get("schema") != 3 or manifest.get("deployment") != {
        "repository": REPOSITORY,
        "branch": "deploy/homelab",
    }:
        raise ValueError("Checked source does not declare this deployment authority")
    configuration = source_configuration(source)
    actual = inputs.input_hash("homelab.config", source, ROOT, configuration)
    if actual != intent["inputs"]:
        raise ValueError("Committed host inputs differ from promotion intent")


def main():
    if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
        raise ValueError("Wrong deployment repository")
    event_name = os.environ["GITHUB_EVENT_NAME"]
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    store = Store(ROOT, f"https://github.com/{REPOSITORY}.git")
    if event_name == "schedule":
        _, state = store.snapshot()
        intent = state["pending"]
        if intent is None:
            print("No pending host promotion")
            return
        verify(intent, allow_manual=True)
    else:
        manual = event_name == "workflow_dispatch"
        if manual:
            values = event["inputs"]
            if values.get("reconcile") != "true":
                raise ValueError("Manual promotion requires explicit reconciliation")
            source, run_id, attempt = values["source"], int(values["run_id"]), int(values["attempt"])
        elif event_name == "workflow_run":
            run = event["workflow_run"]
            source, run_id, attempt = run["head_sha"], run["id"], run["run_attempt"]
        else:
            raise ValueError("Unsupported promotion trigger")
        if not sha(source) or type(run_id) is not int or run_id < 1 or type(attempt) is not int or attempt < 1:
            raise ValueError("Invalid CI identity")
        # A current main checkout can lag the triggering commit. Fetch its exact
        # immutable object; ancestry and policy are checked before publication.
        store.git("fetch", "--quiet", "--no-tags", store.remote, source)
        configuration = source_configuration(source)
        intent = {
            "source": source,
            "run_id": run_id,
            "attempt": attempt,
            "inputs": inputs.input_hash("homelab.config", source, ROOT, configuration),
        }
        selection = None
        if not manual:
            selection = load_selection(run_id)
            if selection.get("head") != source or selection.get("event") != "push":
                raise ValueError("Selection artifact has a different source/context")
            if "homelab.config" not in selection.get("delivery_candidates", []):
                print("No host delivery inputs selected")
                return
        verify(intent, selection, allow_manual=manual)
    # Git CAS is the serializer. A workflow concurrency group can silently replace
    # a pending host run with an app-only run before its intent reaches the journal.
    # Retry only by re-reading and recomputing the same immutable source decision.
    for attempt in range(5):
        try:
            print(promote(store, intent))
            return
        except Conflict:
            if attempt == 4:
                raise


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, subprocess.CalledProcessError, KeyError, OSError, TypeError, AttributeError):
        raise SystemExit("Host promotion was not confirmed; preserve the journal and retry the same source") from None
