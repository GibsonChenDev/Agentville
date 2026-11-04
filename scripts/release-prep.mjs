// Gets a checkout ready for a release build from its tag alone, so tagging is
// the only step a release needs:
//   - the app version (tauri.conf.json, Cargo.toml/.lock, package.json) is set
//     from the tag, whatever the files in the repository say;
//   - the release notes come from docs/release-notes/<tag>.md, looked up in the
//     given folders in order (CI passes the workflow branch's copy first, so notes
//     can be written or fixed after tagging), else they're the commit subjects
//     since the previous release.
//
// Usage, from the checkout being built:
//   node scripts/release-prep.mjs <tag> <notes-out> [<notes-dir>...]
// In GitHub Actions the notes also go to the step output `body`.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** "v1.2.3" → "1.2.3"; pre-releases ("v1.2.3-beta.1") are allowed. */
export function versionFromTag(tag) {
  const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!m) throw new Error(`Release tags look like v1.2.3, not "${tag}"`);
  return m[1];
}

const replaceOnce = (text, re, to, what) => {
  if (!re.test(text)) throw new Error(`No version found in ${what}`);
  return text.replace(re, to);
};

/** The version fields the installers, the updater and Settings read. Paths are relative to the repository root. */
export const VERSION_FILES = {
  'apps/desktop/src-tauri/tauri.conf.json': (t, v) => replaceOnce(t, /("version"\s*:\s*")[^"]*(")/, `$1${v}$2`, 'tauri.conf.json'),
  'apps/desktop/src-tauri/Cargo.toml': (t, v) => replaceOnce(t, /^(version\s*=\s*")[^"]*(")/m, `$1${v}$2`, 'Cargo.toml'),
  'apps/desktop/src-tauri/Cargo.lock': (t, v) => replaceOnce(t, /(name = "agentville"\r?\nversion = ")[^"]*(")/, `$1${v}$2`, 'Cargo.lock'),
  'apps/desktop/package.json': (t, v) => replaceOnce(t, /("version"\s*:\s*")[^"]*(")/, `$1${v}$2`, 'apps/desktop/package.json'),
  'package.json': (t, v) => replaceOnce(t, /("version"\s*:\s*")[^"]*(")/, `$1${v}$2`, 'package.json'),
};

/** Notes made from commit subjects, for a release nobody wrote notes for (English only; the app falls back to it). */
export function notesFromCommits(subjects) {
  const lines = subjects
    .map((s) => s.trim())
    .filter((s) => s && !/^(0\.\d+\.\d+|v?\d+\.\d+\.\d+)\b/.test(s) && !/^Merge /.test(s))
    .slice(0, 20)
    .map((s) => `- ${s}`);
  return `<!-- en -->\n${lines.length ? lines.join('\n') : '- Improvements and fixes.'}\n`;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** Commit subjects since the release before `tag` (all of them when it's the first). */
function subjectsSince(tag) {
  let prev = '';
  try {
    prev = git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${tag}^`);
  } catch {
    // first release: no earlier tag
  }
  const out = git('log', '--no-merges', '--format=%s', prev ? `${prev}..${tag}` : tag);
  return out ? out.split('\n') : [];
}

function main([tag, notesOut, ...noteDirs]) {
  if (!tag || !notesOut) throw new Error('usage: release-prep.mjs <tag> <notes-out> [<notes-dir>...]');
  const version = versionFromTag(tag);
  for (const [file, bump] of Object.entries(VERSION_FILES)) writeFileSync(file, bump(readFileSync(file, 'utf8'), version));
  console.log(`Version ${version} (from ${tag})`);

  const written = noteDirs.map((d) => join(d, `${tag}.md`)).find((f) => existsSync(f));
  let notes;
  if (written) {
    notes = readFileSync(written, 'utf8');
    console.log(`Notes: ${written}`);
  } else {
    notes = notesFromCommits(subjectsSince(tag));
    console.log(`::warning::No docs/release-notes/${tag}.md, so the notes list the commits since the previous release. Add the file on main and re-run the workflow for friendlier, bilingual notes.`);
  }
  writeFileSync(notesOut, notes);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `body<<EOF_NOTES\n${notes.trimEnd()}\nEOF_NOTES\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
