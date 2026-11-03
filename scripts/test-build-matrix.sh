#!/usr/bin/env bash
# Production builds must match the Mac mini without CPU emulation.
set -euo pipefail
bun - <<'JS'
const assert = require('node:assert/strict');
for (const path of ['.github/workflows/ci.yml', '.github/workflows/deploy-mini.yml']) {
  const workflow = Bun.YAML.parse(await Bun.file(path).text());
  const builds = Object.values(workflow.jobs).filter(job => job.steps?.some(s => s.uses?.startsWith('docker/build-push-action@')));
  assert.equal(builds.length, 1, `${path}: expected one app image build`);
  for (const job of builds) {
    assert.equal(job['runs-on'], 'ubuntu-24.04-arm', `${path}: native ARM64 runner required`);
    assert(!job.steps.some(s => s.uses?.includes('setup-qemu')), `${path}: emulation is unnecessary`);
    const build = job.steps.find(s => s.uses?.startsWith('docker/build-push-action@'));
    assert.equal(build.with.platforms, 'linux/arm64');
    assert.equal(build.with.file, 'Dockerfile');
  }
}
console.log('PASS: CI and production use the single native ARM64 image');
JS
