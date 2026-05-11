#!/usr/bin/env node
/**
 * WorkProof build script
 * Copies src/ → dist/ and strips the live-reload injection point
 * (the server injects it at runtime; dist is clean static output)
 */

const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..', 'src');
const DIST = path.join(__dirname, '..', 'dist');

// ── Helpers ──────────────────────────────────────────
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      let data = fs.readFileSync(srcPath);
      // For HTML files, ensure no stale reload snippets
      if (entry.name.endsWith('.html')) {
        let html = data.toString();
        // Remove any accidental injected reload scripts
        html = html.replace(/<script>\s*\(function\(\)\s*\{[\s\S]*?EventSource[\s\S]*?\}\)\(\);\s*<\/script>/g, '');
        data = Buffer.from(html);
      }
      fs.writeFileSync(destPath, data);
      console.log(`  ✓  ${path.relative(process.cwd(), destPath)}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────
console.log('\n  Building WorkProof…\n');

if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
  console.log('  ✓  Cleaned dist/\n');
}

copyDir(SRC, DIST);

// GitHub Pages needs index.html at root — already there if src/index.html exists
// Add a .nojekyll file so GH Pages doesn't process with Jekyll
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log('  ✓  dist/.nojekyll\n');

console.log('  ✅  Build complete → dist/\n');
