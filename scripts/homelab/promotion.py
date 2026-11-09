#!/usr/bin/env python3
"""CAS host promotion and bounded enrollment holds in one atomic Git transaction.

Control history contains public metadata only. Hosts follow the source commit on
`deploy/homelab`; `control/homelab` journals decisions without modifying source.
"""

import copy
import json
import os
import re
import subprocess
import time
from pathlib import Path

DEPLOY = "refs/heads/deploy/homelab"
CONTROL = "refs/heads/control/homelab"
MAIN = "refs/heads/main"
REPOSITORY = "0x63616c/world-wide-webb"
MAX_LEASE_SECONDS = 2 * 60 * 60


def sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def token(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


class Conflict(RuntimeError):
    pass


class Store:
    """One atomic compare-and-swap covers lease state and the deployment ref."""

    def __init__(self, repository, remote):
        self.repository = Path(repository)
        self.remote = remote

    def git(self, *args, data=None, env=None):
        command = ["git"]
        if os.environ.get("GH_TOKEN"):
            command += ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]
        result = subprocess.run(
            command + list(args), cwd=self.repository, input=data, capture_output=True, text=True, env=env
        )
        if result.returncode:
            # Git/provider output may contain private URLs, tokens or banners.
            raise Conflict("Git operation was not confirmed; refresh the same transaction")
        return result.stdout.strip()

    def ancestor(self, older, newer):
        result = subprocess.run(
            ["git", "merge-base", "--is-ancestor", older, newer], cwd=self.repository, capture_output=True
        )
        if result.returncode not in (0, 1):
            raise Conflict("Source ancestry is unavailable")
        return result.returncode == 0

    def snapshot(self):
        rows = self.git("ls-remote", "--refs", self.remote, MAIN, CONTROL, DEPLOY)
        refs = {}
        for line in rows.splitlines():
            identity, ref = line.split("\t", 1)
            if ref not in (MAIN, CONTROL, DEPLOY) or ref in refs or not sha(identity):
                raise Conflict("Unexpected remote state")
            refs[ref] = identity
        if MAIN not in refs:
            raise Conflict("Authoring main is absent")
        for ref, expected in refs.items():
            self.git("fetch", "--quiet", "--no-tags", self.remote, ref)
            if self.git("rev-parse", "FETCH_HEAD") != expected:
                raise Conflict("Remote changed during observation; retry")
        if CONTROL not in refs:
            if DEPLOY in refs:
                raise Conflict("Deployment exists without its journal; explicit recovery is required")
            state = {"schema": 1, "deployed": None, "receipt": None, "lease": None, "pending": None}
        else:
            if self.git("ls-tree", "--name-only", refs[CONTROL]) != "state.json":
                raise Conflict("Unexpected control tree")
            state = json.loads(self.git("show", refs[CONTROL] + ":state.json"))
        validate_state(state)
        if state["deployed"] != refs.get(DEPLOY):
            raise Conflict("Deployment and control journal differ; preserve them for recovery")
        return refs, state

    def commit(self, refs, before, after):
        validate_state(after)
        if before == after:
            return refs.get(CONTROL)
        blob = self.git("hash-object", "-w", "--stdin", data=json.dumps(after, sort_keys=True) + "\n")
        tree = self.git("mktree", data=f"100644 blob {blob}\tstate.json\n")
        parents = ["-p", refs[CONTROL]] if CONTROL in refs else []
        env = dict(
            os.environ,
            GIT_AUTHOR_NAME="Homelab automation",
            GIT_AUTHOR_EMAIL="actions@users.noreply.github.com",
            GIT_COMMITTER_NAME="Homelab automation",
            GIT_COMMITTER_EMAIL="actions@users.noreply.github.com",
        )
        control = self.git("commit-tree", tree, *parents, data="Record homelab deployment transaction\n", env=env)
        pushes = [f"--force-with-lease={CONTROL}:{refs.get(CONTROL, '')}", f"{control}:{CONTROL}"]
        if after["deployed"] != before["deployed"]:
            if before["deployed"] and not self.ancestor(before["deployed"], after["deployed"]):
                raise Conflict("Deployment cannot rewind or leave its source history")
            pushes += [f"--force-with-lease={DEPLOY}:{refs.get(DEPLOY, '')}", f"{after['deployed']}:{DEPLOY}"]
        else:
            # Include the unchanged deploy ref: a manual ref race must also fail the CAS.
            # Git can omit unchanged refs on push, so post-readback is mandatory too.
            if DEPLOY in refs:
                pushes += [f"--force-with-lease={DEPLOY}:{refs[DEPLOY]}", f"{refs[DEPLOY]}:{DEPLOY}"]
        try:
            self.git("push", "--atomic", self.remote, *pushes)
        except Conflict:
            observed, current = self.snapshot()
            if observed.get(CONTROL) == control and current == after:
                return control  # Lost successful response, confirmed by exact readback.
            raise
        observed, current = self.snapshot()
        if observed.get(CONTROL) != control or current != after:
            raise Conflict("Transaction changed after publication; refresh before acting")
        return control


def validate_intent(intent):
    if not isinstance(intent, dict) or set(intent) != {"source", "run_id", "attempt", "inputs"}:
        raise ValueError("Invalid promotion intent")
    if not sha(intent["source"]) or not token(intent["inputs"]):
        raise ValueError("Invalid source/input identity")
    if any(type(intent[key]) is not int or intent[key] < 1 for key in ("run_id", "attempt")):
        raise ValueError("Invalid CI attempt")


def validate_state(state):
    if (
        not isinstance(state, dict)
        or set(state) != {"schema", "deployed", "receipt", "lease", "pending"}
        or state["schema"] != 1
    ):
        raise ValueError("Unsupported promotion journal")
    if state["deployed"] is not None and not sha(state["deployed"]):
        raise ValueError("Invalid deployed revision")
    for name in ("receipt", "pending"):
        if state[name] is not None:
            validate_intent(state[name])
    if (state["receipt"] is None) != (state["deployed"] is None):
        raise ValueError("Missing deployed receipt")
    if state["receipt"] and state["receipt"]["source"] != state["deployed"]:
        raise ValueError("Receipt and deployment differ")
    lease = state["lease"]
    if lease is not None:
        if not isinstance(lease, dict) or set(lease) != {"id", "host", "source", "expires", "phase"}:
            raise ValueError("Invalid enrollment lease")
        if (
            not token(lease["id"])
            or lease["source"] != state["deployed"]
            or not re.fullmatch(r"[a-z][a-z0-9-]{0,62}", lease["host"])
        ):
            raise ValueError("Lease binding differs")
        if type(lease["expires"]) is not int or lease["phase"] not in ("prepared", "activating", "expired"):
            raise ValueError("Invalid lease deadline/phase")


def promote(store, intent):
    """Call only after validating trusted CI; a held promoter exits without waiting."""
    validate_intent(intent)
    refs, state = store.snapshot()
    source = intent["source"]
    if not store.ancestor(source, refs[MAIN]):
        raise Conflict("Candidate is outside authoring main")
    deployed = state["deployed"]
    if deployed and not store.ancestor(deployed, source):
        if store.ancestor(source, deployed):
            return "superseded"
        raise Conflict("Candidate is not a forward deployment")
    if source == deployed:
        return "already-promoted"
    after = copy.deepcopy(state)
    pending = after["pending"]
    if pending and not store.ancestor(pending["source"], source):
        if store.ancestor(source, pending["source"]):
            return "superseded-pending"
        raise Conflict("Pending candidate has divergent history")
    lease = after["lease"]
    if lease and lease["phase"] == "prepared" and lease["expires"] <= int(time.time()):
        # No activation was claimed. A late client must reacquire and check the
        # deployed source before starting its irreversible installation step.
        after["lease"] = None
        lease = None
    if lease is not None:
        # Expiry cannot silently abandon an in-flight install. A separate recovery
        # observation must clear it. No CI runner remains occupied while held.
        if lease["expires"] <= int(time.time()):
            lease["phase"] = "expired"
        after["pending"] = intent
        store.commit(refs, state, after)
        return "queued"
    after.update(deployed=source, receipt=intent, pending=None)
    store.commit(refs, state, after)
    return "promoted"


def lease(store, action, identity, host, source, seconds=MAX_LEASE_SECONDS):
    """A resumable bounded hold; only the same attempt can renew or finish it.

    Expired activation stays fenced for explicit recovery, never automatic rewind.
    Releasing a hold does not promote a queued candidate without fresh CI evidence.
    """
    if not token(identity) or not sha(source) or not re.fullmatch(r"[a-z][a-z0-9-]{0,62}", host):
        raise ValueError("Invalid lease identity")
    if type(seconds) is not int or not 1 <= seconds <= MAX_LEASE_SECONDS:
        raise ValueError("Lease duration exceeds its bound")
    refs, state = store.snapshot()
    if state["deployed"] != source:
        raise Conflict("Candidate was superseded; revalidate before activation")
    after = copy.deepcopy(state)
    current = after["lease"]
    binding = {"id": identity, "host": host, "source": source}
    if current and any(current[key] != value for key, value in binding.items()):
        raise Conflict("Another enrollment owns deployment promotion")
    now = int(time.time())
    if action == "acquire":
        if current:
            if current["expires"] <= now:
                raise Conflict("Expired enrollment needs explicit recovery")
            return current  # Retrying an acquire never extends its deadline.
        after["lease"] = dict(binding, expires=now + seconds, phase="prepared")
    elif action in ("renew", "activate", "verify"):
        if not current or current["expires"] <= now or current["phase"] == "expired":
            raise Conflict("Lease is absent or expired; inspect the same enrollment")
        if action == "verify":
            return current
        current["expires"] = now + seconds
        if action == "activate":
            current["phase"] = "activating"
    elif action in ("release", "recover-release"):
        if not current:
            return None
        if action == "release" and current["expires"] <= now:
            raise Conflict("Expired enrollment needs explicit recovery")
        # Caller must provide exact-source host observation before release. This
        # state primitive alone is not proof of successful installation/recovery.
        after["lease"] = None
    else:
        raise ValueError("Unknown lease action")
    store.commit(refs, state, after)
    return after["lease"]
