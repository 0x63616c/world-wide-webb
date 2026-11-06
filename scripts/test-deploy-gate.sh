#!/usr/bin/env bash
# A successful main CI run must deploy that exact revision, without a path gap.
set -euo pipefail
bun - <<'JS'
const assert = require('node:assert/strict');
const compose = Bun.YAML.parse(await Bun.file('deploy/mini/compose.yaml').text());
for (const [key, fallback] of Object.entries({
  BEDROOM_SWITCH_INPUT_ENABLED: 'false',
  BEDROOM_SWITCH_INPUT_VERIFIED: 'false',
  BEDROOM_SWITCH_INPUT_ENTITY_ID: '',
})) {
  assert.equal(compose.services.www.environment[key], '${' + key + ':-' + fallback + '}',
    `${key} must reach www with an unset/empty-safe disabled default`);
}
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
const recovery = job.steps.find(s => s.name === 'Install tunnel recovery');
assert(recovery, 'tested tunnel recovery must be installed on the mini');
assert.equal(recovery.env.GENERATION, '${{ github.event.workflow_run.run_number }}');
assert(job.steps.indexOf(recovery) > job.steps.indexOf(release));
assert(recovery.run.includes('StrictHostKeyChecking=yes'));
for (const file of ['tunnel_watchdog.py', 'com.calum.tunnel-recovery.plist', 'install-tunnel-recovery.sh']) {
  assert(recovery.run.includes(`deploy/mini/${file}`));
}
assert(ci.jobs['test-unit'].steps.some(s => s.run?.includes("-s deploy/mini -p 'test_*.py'")),
  'CI must exercise tunnel recovery failure cases');
console.log('PASS: successful main CI deploys the tested SHA and immutable digest');
JS
