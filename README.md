# WorkProof — Local Setup & Deploy Guide

Verified contribution protocol. Peer-validated. Blockchain-settled. Privacy-first.

---

## Prerequisites (Mac)

You need Node.js ≥ 18 and Git. Check with:

```bash
node --version   # should be v18+
git --version
```

If you don't have Node: https://nodejs.org (download the LTS installer)

---

## 1. Clone / set up the repo

If starting from scratch:

```bash
# Create the repo on GitHub first (name it: workproof)
# Then clone it locally:
git clone https://github.com/Amentinho/workproof.git
cd workproof
```

If you already have the files, just init git:

```bash
cd ~/Projects/workproof   # or wherever you put it
git init
git remote add origin https://github.com/Amentinho/workproof.git
```

---

## 2. Project structure

```
workproof/
├── src/
│   └── index.html        ← the app lives here (edit this)
├── scripts/
│   ├── server.js         ← local dev server (zero dependencies)
│   ├── build.js          ← copies src/ → dist/
│   └── deploy-gh-pages.js← pushes dist/ to gh-pages branch
├── package.json
├── .gitignore
└── README.md
```

---

## 3. Run locally

```bash
node scripts/server.js
# or: npm run dev
```

Open http://localhost:3000

**Live reload is built in.** Edit `src/index.html`, save → browser refreshes automatically. No extra tools needed.

---

## 4. Deploy to GitHub Pages

**One-time setup on GitHub:**

1. Go to your repo → Settings → Pages
2. Source: **Deploy from a branch**
3. Branch: **gh-pages** / root
4. Save

**Deploy:**

```bash
npm run deploy
```

This runs the build (copies `src/` → `dist/`) and pushes `dist/` to the `gh-pages` branch.

Your app will be live at:
```
https://Amentinho.github.io/workproof/
```
(takes ~60 seconds after the first push)

---

## 5. Typical dev workflow

```bash
# Start the server
npm run dev

# Edit src/index.html → browser auto-reloads

# When ready to publish:
npm run deploy
```

---

## 6. Adding more pages / assets

Put everything inside `src/`:

```
src/
├── index.html
├── dashboard.html    ← future: separate dashboard page
├── assets/
│   ├── logo.svg
│   └── og-image.png
```

The build script copies the entire `src/` tree to `dist/` verbatim.

---

## 7. Next steps (Solana integration)

When we add the Solana program:

```
src/
├── index.html
├── js/
│   ├── solana.js     ← wallet adapter + program calls
│   ├── escrow.js     ← escrow vault interactions
│   └── leaderboard.js← on-chain leaderboard reads
├── idl/
│   └── workproof.json← Anchor IDL (auto-generated)
```

All vanilla JS — no bundler needed for the hackathon demo.

---

## Troubleshooting

**Port 3000 already in use:**
```bash
lsof -ti:3000 | xargs kill -9
npm run dev
```

**gh-pages branch not showing up:**
Make sure you enabled GitHub Pages in repo Settings → Pages first.

**Changes not showing on GitHub Pages:**
GitHub Pages can take 1–2 minutes. Hard refresh with Cmd+Shift+R.

**Git push rejected:**
```bash
git remote -v  # verify origin points to your repo
```
