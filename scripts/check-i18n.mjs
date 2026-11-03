// Translation quality gate: key parity between en and zh-TW, no empty strings,
// identical interpolation variables, and no obvious Simplified-only characters in zh-TW.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../apps/desktop/src/locales/', import.meta.url));
const flatten = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) typeof v === 'string' ? (out[p + k] = v) : flatten(v, `${p}${k}.`, out);
  return out;
};
const vars = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
// Characters that only appear in Simplified Chinese (a small, high-signal sample).
const SIMPLIFIED = /[们这来时为说国个过发问还进对开关么点项设务择语简体请认据数显试运]/;

let errors = 0;
const fail = (msg) => {
  errors++;
  console.error(`✗ ${msg}`);
};
for (const file of readdirSync(join(root, 'en'))) {
  const en = flatten(JSON.parse(readFileSync(join(root, 'en', file), 'utf8')));
  const tw = flatten(JSON.parse(readFileSync(join(root, 'zh-TW', file), 'utf8')));
  for (const k of Object.keys(en)) if (!(k in tw)) fail(`${file}: zh-TW missing ${k}`);
  for (const k of Object.keys(tw)) if (!(k in en)) fail(`${file}: en missing ${k}`);
  for (const [k, v] of Object.entries(tw)) {
    if (!v.trim()) fail(`${file}: zh-TW empty ${k}`);
    if (SIMPLIFIED.test(v)) fail(`${file}: zh-TW ${k} contains Simplified characters: ${v}`);
    if (k in en && vars(v) !== vars(en[k])) fail(`${file}: interpolation mismatch in ${k}`);
  }
  for (const [k, v] of Object.entries(en)) if (!v.trim()) fail(`${file}: en empty ${k}`);
}
if (errors) {
  console.error(`${errors} localization problem(s)`);
  process.exit(1);
}
console.log('✓ en / zh-TW locales are in parity');
