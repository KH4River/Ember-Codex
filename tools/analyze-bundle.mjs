// Reports which packages dominate a built bundle.
//   npx ng build --configuration production --stats-json   (from angular/)
//   node tools/analyze-bundle.mjs
//
// Reads Angular's esbuild metafile and attributes bytesInOutput to the owning
// package; Material and CDK are split by submodule.
import { readFileSync } from 'node:fs';

const STATS = new URL('../angular/dist/ember-codex/stats.json', import.meta.url);
const stats = JSON.parse(readFileSync(STATS, 'utf8'));

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

const entry = Object.entries(stats.outputs).find(
  ([name, o]) => o.entryPoint === 'src/main.ts' && name.endsWith('.js'),
);
if (!entry) {
  console.error('No main.js output found in stats.json. Run a --stats-json build first.');
  process.exit(1);
}
const [mainName, output] = entry;

// Paths look like ../node_modules/@angular/material/fesm2022/button.mjs, so
// the submodule is the basename rather than a directory.
const byPackage = new Map();
for (const [file, info] of Object.entries(output.inputs ?? {})) {
  const size = info.bytesInOutput ?? 0;
  if (!size) continue;

  const parts = file.split(/[\\/]/);
  const nm = parts.indexOf('node_modules');
  let key = '(app code)';

  if (nm !== -1) {
    const scope = parts[nm + 1];
    const name = parts[nm + 2];
    const fileName = parts[parts.length - 1].replace(/\.m?js$/, '');
    const isScoped = typeof scope === 'string' && scope.startsWith('@');
    if (isScoped) {
      const deep = name === 'material' || name === 'cdk';
      key = deep ? `${scope}/${name}/${fileName}` : `${scope}/${name}`;
    } else {
      // Unscoped: the package name is the segment right after node_modules.
      key = String(scope);
    }
  }

  byPackage.set(key, (byPackage.get(key) ?? 0) + size);
}

const total = [...byPackage.values()].reduce((a, b) => a + b, 0);
console.log(`${mainName}: ${bytes(total)} across ${byPackage.size} groups\n`);

const isUi = (k) => k.startsWith('@angular/material') || k.startsWith('@angular/cdk');
const ui = [...byPackage].filter(([k]) => isUi(k));
const uiTotal = ui.reduce((a, [, b]) => a + b, 0);
console.log(`Angular Material + CDK: ${bytes(uiTotal)} (${((uiTotal / total) * 100).toFixed(1)}%)\n`);

for (const [k, b] of ui.sort((a, b) => b[1] - a[1]).slice(0, 18)) {
  const pct = ((b / total) * 100).toFixed(1).padStart(5);
  console.log(`${pct}%  ${bytes(b).padStart(10)}  ${k.replace('@angular/', '')}`);
}

console.log('\n--- rest of the bundle ---');
for (const [k, b] of [...byPackage].filter(([k]) => !isUi(k)).sort((a, b) => b[1] - a[1])) {
  const pct = ((b / total) * 100).toFixed(1).padStart(5);
  console.log(`${pct}%  ${bytes(b).padStart(10)}  ${k}`);
}