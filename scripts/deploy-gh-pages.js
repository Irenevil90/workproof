#!/usr/bin/env node
/**
 * WorkProof GitHub Pages deploy
 * Pushes dist/ to the gh-pages branch of the current repo.
 * Zero npm dependencies — uses git directly.
 *
 * Usage:  npm run deploy
 * Prereq: git remote "origin" must point to your GitHub repo
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const DIST   = path.join(__dirname, '..', 'dist');
const BRANCH = 'gh-pages';

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

// ── Pre-flight checks ────────────────────────────────
if (!fs.existsSync(DIST)) {
  console.error('\n  ❌  dist/ not found. Run `npm run build` first.\n');
  process.exit(1);
}

// Check we have a git remote
let remote;
try {
  remote = runCapture('git remote get-url origin');
} catch {
  console.error('\n  ❌  No git remote "origin" found.');
  console.error('     Run: git remote add origin https://github.com/Amentinho/workproof.git\n');
  process.exit(1);
}

console.log(`\n  Deploying to GitHub Pages…`);
console.log(`  Remote: ${remote}`);
console.log(`  Branch: ${BRANCH}\n`);

// ── Deploy using a detached worktree approach ────────
// This avoids touching the main branch working tree.
const TMP = path.join(__dirname, '..', '.gh-pages-tmp');

try {
  // Clean up any leftover tmp dir
  if (fs.existsSync(TMP)) {
    fs.rmSync(TMP, { recursive: true });
  }

  // Create orphan branch or checkout existing gh-pages
  try {
    run(`git worktree add --orphan -b ${BRANCH} "${TMP}"`);
  } catch {
    // Branch already exists — check it out
    if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true });
    run(`git worktree add "${TMP}" ${BRANCH}`);
    // Clear the worktree
    fs.readdirSync(TMP)
      .filter(f => f !== '.git')
      .forEach(f => fs.rmSync(path.join(TMP, f), { recursive: true, force: true }));
  }

  // Copy dist/ into the worktree
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
  console.log('\n  ✓  Copied dist/ to worktree\n');

  // Commit and push from within the worktree
  const sha = runCapture('git rev-parse --short HEAD');
  const date = new Date().toISOString().slice(0,19).replace('T',' ');
  run(`git -C "${TMP}" add -A`);
  run(`git -C "${TMP}" commit -m "deploy: ${date} (${sha})" --allow-empty`);
  run(`git -C "${TMP}" push origin ${BRANCH} --force`);

  console.log('\n  ✅  Deployed!\n');
  console.log(`  🌐  Your app will be live in ~60s at:`);
  // Extract org/repo from remote URL
  const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (match) {
    const [org, repo] = match[1].split('/');
    console.log(`      https://${org}.github.io/${repo}/\n`);
  }

} finally {
  // Always clean up the worktree
  try {
    run(`git worktree remove "${TMP}" --force`);
  } catch {}
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
}
