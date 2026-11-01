// Run every checked-in browser regression in a fresh process and context.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const scripts = fs.readdirSync(__dirname).filter(name => name.endsWith('-browser.cjs') && name !== path.basename(__filename)).sort();
let failed = 0;
for (const script of scripts) {
  console.log('\nBROWSER ' + script);
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit', timeout: 180000 });
  if (result.error || result.status !== 0) { failed++; console.error('FAILED ' + script, result.error?.message || result.status); }
}
console.log(`\nBrowser scripts: ${scripts.length - failed}/${scripts.length} passed`);
process.exitCode = failed ? 1 : 0;
