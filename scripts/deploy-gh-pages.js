#!/usr/bin/env node
/**
 * WorkProof GitHub Pages deploy — fixed for older Git versions
 * Pushes dist/ to gh-pages branch using a temp directory.
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const DIST   = path.join(__dirname, '..', 'dist');
const BRANCH = 'gh-pages';
const TMP    = path.join(__dirname, '..', '.gh-pages-tmp');

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

// Pre-flight
if (!fs.existsSync(DIST)) {
  console.error('\n  ❌  dist/ not found. Run `npm run build` first.\n');
  process.exit(1);
}

let remote;
try {
  remote = runCapture('git remote get-url origin');
} catch {
  console.error('\n  ❌  No git remote "origin" found.\n');
  process.exit(1);
}

console.log(`\n  Deploying to GitHub Pages…`);
console.log(`  Remote: ${remote.replace(/:[^@]+@/, ':***@')}`);
console.log(`  Branch: ${BRANCH}\n`);

// Clean up any leftover tmp
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });

try {
  // Check if gh-pages branch exists remotely
  let branchExists = false;
  try {
    runCapture(`git ls-remote --exit-code origin ${BRANCH}`);
    branchExists = true;
  } catch {}

  // Create a fresh temp git repo
  fs.mkdirSync(TMP, { recursive: true });
  run(`git -C "${TMP}" init -b ${BRANCH}`);
  run(`git -C "${TMP}" remote add origin "${remote}"`);

  if (branchExists) {
    run(`git -C "${TMP}" fetch origin ${BRANCH} --depth=1`);
    run(`git -C "${TMP}" reset --hard origin/${BRANCH}`);
    // Clear all files
    fs.readdirSync(TMP)
      .filter(f => f !== '.git')
      .forEach(f => fs.rmSync(path.join(TMP, f), { recursive: true, force: true }));
  }

  // Copy dist/ into tmp
  function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src,  entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }
  copyDir(DIST, TMP);
  console.log('\n  ✓  Copied dist/ to temp repo\n');

  const sha  = runCapture('git rev-parse --short HEAD');
  const date = new Date().toISOString().slice(0,19).replace('T',' ');

  run(`git -C "${TMP}" add -A`);
  run(`git -C "${TMP}" -c user.email="deploy@workproof" -c user.name="WorkProof Deploy" commit -m "deploy: ${date} (${sha})" --allow-empty`);
  run(`git -C "${TMP}" push origin HEAD:${BRANCH} --force`);

  console.log('\n  ✅  Deployed!\n');
  const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (match) {
    const parts = match[1].split('/');
    console.log(`  🌐  https://${parts[0]}.github.io/${parts[1]}/\n`);
  }

} finally {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
}
