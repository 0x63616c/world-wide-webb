#!/usr/bin/env bash
# A successful main CI run must deploy that exact revision, without a path gap.
set -euo pipefail
bun - <<'JS'
const assert = require('node:assert/strict');
const ci = Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text());
const deploy = Bun.YAML.parse(await Bun.file('.github/workflows/deploy-mini.yml').text());
assert.deepEqual(ci.on.push.branches, ['main']);
assert.deepEqual(deploy.on.workflow_run, {workflows: ['CI'], types: ['completed'], branches: ['main']});
for (const check of ['test-unit', 'typecheck']) {
  assert(ci.jobs[check], `required check ${check} missing`);
  assert(!ci.jobs[check].if, `${check} must not be skipped by path filters`);
  assert(!ci.jobs[check]['continue-on-error'], `${check} failures must block CI`);
}
assert(!ci.jobs['deploy-home-server'], 'retired Talos deployment must not return');
const job = deploy.jobs.release;
assert.equal(job.if.trim(), "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && vars.MINI_DEPLOY_ENABLED == 'true'");
const checkout = job.steps.find(s => s.uses?.startsWith('actions/checkout@'));
assert.equal(checkout.with.ref, '${{ github.event.workflow_run.head_sha }}');
const release = job.steps.find(s => s.name === 'Deploy and verify');
assert.equal(release.env.REVISION, '${{ github.event.workflow_run.head_sha }}');
assert.equal(release.env.GENERATION, '${{ github.event.workflow_run.run_number }}');
assert(release.run.includes('StrictHostKeyChecking=yes'));
assert(release.env.IMAGE.includes('@${{ steps.image.outputs.digest }}'));
assert(release.run.includes('release.sh'));
console.log('PASS: successful main CI deploys the tested SHA and immutable digest');
JS
