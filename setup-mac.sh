#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  WorkProof — Mac Setup Script
#  Installs: Homebrew → Node.js → Git → Rust → Solana CLI → Anchor
#  Run with: bash setup-mac.sh
# ═══════════════════════════════════════════════════════════

set -e  # stop on first error

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
info() { echo -e "  ${CYAN}→${NC}  $1"; }
step() { echo -e "\n${BOLD}$1${NC}"; }
fail() { echo -e "  ${RED}✗${NC}  $1"; exit 1; }

echo ""
echo -e "${BOLD}  ╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}  ║   WorkProof — Mac Environment Setup      ║${NC}"
echo -e "${BOLD}  ╚══════════════════════════════════════════╝${NC}"
echo ""

# ─────────────────────────────────────────────
# 1. HOMEBREW
# ─────────────────────────────────────────────
step "1/7  Homebrew"
if command -v brew &>/dev/null; then
  ok "Homebrew already installed ($(brew --version | head -1))"
else
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon Macs
  if [[ -f "/opt/homebrew/bin/brew" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  fi
  ok "Homebrew installed"
fi

# ─────────────────────────────────────────────
# 2. NODE.JS
# ─────────────────────────────────────────────
step "2/7  Node.js"
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  NODE_MAJOR=$(echo $NODE_VER | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "Node.js $NODE_VER already installed"
  else
    warn "Node.js $NODE_VER is too old (need v18+). Upgrading..."
    brew install node@22
    brew link --overwrite node@22
    ok "Node.js upgraded to $(node --version)"
  fi
else
  info "Installing Node.js v22 LTS..."
  brew install node@22
  brew link node@22
  ok "Node.js $(node --version) installed"
fi

# ─────────────────────────────────────────────
# 3. GIT
# ─────────────────────────────────────────────
step "3/7  Git"
if command -v git &>/dev/null; then
  ok "Git $(git --version | cut -d' ' -f3) already installed"
else
  info "Installing Git..."
  brew install git
  ok "Git installed"
fi

# Git identity check
GIT_NAME=$(git config --global user.name 2>/dev/null || echo "")
GIT_EMAIL=$(git config --global user.email 2>/dev/null || echo "")
if [ -z "$GIT_NAME" ] || [ -z "$GIT_EMAIL" ]; then
  echo ""
  warn "Git identity not configured. Enter your details:"
  read -p "  Your name (e.g. Andrea): " GIT_NAME_INPUT
  read -p "  Your email (GitHub email): " GIT_EMAIL_INPUT
  git config --global user.name "$GIT_NAME_INPUT"
  git config --global user.email "$GIT_EMAIL_INPUT"
  ok "Git identity set"
else
  ok "Git identity: $GIT_NAME <$GIT_EMAIL>"
fi

# ─────────────────────────────────────────────
# 4. RUST
# ─────────────────────────────────────────────
step "4/7  Rust (required by Solana + Anchor)"
if command -v rustc &>/dev/null; then
  ok "Rust $(rustc --version | cut -d' ' -f2) already installed"
  info "Updating Rust to latest stable..."
  rustup update stable 2>&1 | tail -1
  ok "Rust up to date"
else
  info "Installing Rust via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --quiet
  source "$HOME/.cargo/env"
  ok "Rust $(rustc --version | cut -d' ' -f2) installed"
fi

# Make sure cargo is in PATH for this session
source "$HOME/.cargo/env" 2>/dev/null || true

# ─────────────────────────────────────────────
# 5. SOLANA CLI
# ─────────────────────────────────────────────
step "5/7  Solana CLI"
if command -v solana &>/dev/null; then
  ok "Solana CLI $(solana --version | cut -d' ' -f2) already installed"
else
  info "Installing Solana CLI v1.18 (stable)..."
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
  # Add to PATH
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
  if ! grep -q 'solana' ~/.zshrc 2>/dev/null; then
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zshrc
  fi
  if ! grep -q 'solana' ~/.zprofile 2>/dev/null; then
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zprofile
  fi
  ok "Solana CLI $(solana --version | cut -d' ' -f2) installed"
fi

# Configure devnet
info "Configuring Solana CLI for devnet..."
solana config set --url devnet --quiet
ok "Solana CLI → devnet"

# ─────────────────────────────────────────────
# 6. ANCHOR
# ─────────────────────────────────────────────
step "6/7  Anchor CLI"
if command -v anchor &>/dev/null; then
  ok "Anchor $(anchor --version) already installed"
else
  info "Installing Anchor v0.29.0 via avm (Anchor Version Manager)..."
  cargo install --git https://github.com/coral-xyz/anchor avm --locked --quiet
  avm install 0.29.0
  avm use 0.29.0
  ok "Anchor $(anchor --version) installed"
fi

# ─────────────────────────────────────────────
# 7. PROJECT SETUP
# ─────────────────────────────────────────────
step "7/7  WorkProof project"

# Check if we're already in the project dir or need to find it
if [ -f "package.json" ] && grep -q "workproof" package.json 2>/dev/null; then
  PROJECT_DIR=$(pwd)
  ok "Already in workproof project directory"
elif [ -d "$HOME/Projects/workproof" ]; then
  PROJECT_DIR="$HOME/Projects/workproof"
  ok "Found project at $PROJECT_DIR"
else
  info "WorkProof project not found locally yet."
  info "You need to extract workproof-project.tar.gz first."
  info "Run: tar -xzf ~/Downloads/workproof-project.tar.gz -C ~/Projects/"
  PROJECT_DIR="$HOME/Projects/workproof"
fi

# ─────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}  ╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}  ║   ✅  All done! Environment ready.        ║${NC}"
echo -e "${BOLD}  ╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Versions installed:${NC}"
echo "  Node.js  $(node --version 2>/dev/null || echo 'restart terminal')"
echo "  npm      $(npm --version 2>/dev/null || echo 'restart terminal')"
echo "  git      $(git --version | cut -d' ' -f3)"
echo "  rust     $(rustc --version 2>/dev/null | cut -d' ' -f2 || echo 'restart terminal')"
echo "  solana   $(solana --version 2>/dev/null | cut -d' ' -f2 || echo 'restart terminal')"
echo "  anchor   $(anchor --version 2>/dev/null || echo 'restart terminal')"
echo ""
echo -e "  ${CYAN}Next steps:${NC}"
echo ""
echo -e "  ${BOLD}1.${NC} Restart Terminal (so all PATH changes take effect)"
echo ""
echo -e "  ${BOLD}2.${NC} Extract the project (if not done yet):"
echo "     tar -xzf ~/Downloads/workproof-project.tar.gz -C ~/Projects/"
echo "     cd ~/Projects/workproof"
echo ""
echo -e "  ${BOLD}3.${NC} Connect to GitHub:"
echo "     git init"
echo "     git remote add origin https://github.com/Irenevil90/workproof.git"
echo "     git branch -M main"
echo "     git add ."
echo "     git commit -m 'feat: WorkProof v0.1'"
echo "     git push -u origin main"
echo ""
echo -e "  ${BOLD}4.${NC} Run locally:"
echo "     node scripts/server.js"
echo "     → open http://localhost:3000"
echo ""
echo -e "  ${BOLD}5.${NC} Deploy to GitHub Pages:"
echo "     npm run deploy"
echo "     → https://irenevil90.github.io/workproof/"
echo ""
echo -e "  ${YELLOW}⚠  If any 'command not found' errors appear after restart,${NC}"
echo -e "  ${YELLOW}   run: source ~/.zshrc${NC}"
echo ""
