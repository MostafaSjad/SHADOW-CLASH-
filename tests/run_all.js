/* runs every SHADOW CLASH test suite in order:  node tests/run_all.js  */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['test_sim.js', 'test_net.js', 'test_client.js'];
let failed = 0;

for (const suite of suites) {
  console.log('\n============ ' + suite + ' ============\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.log('>>> ' + suite + ' FAILED');
  }
}

console.log('\n========================================');
if (failed) {
  console.log('  ' + failed + ' suite(s) failed');
  process.exit(1);
}
console.log('  ALL SUITES PASSED');
