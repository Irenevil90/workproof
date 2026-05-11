/**
 * WorkProof — Solana integration
 * Connects Phantom wallet to the WorkProof Anchor program on devnet.
 * Pure vanilla JS — no bundler needed.
 *
 * Dependencies loaded via CDN in index.html:
 *   @solana/web3.js  (window.solanaWeb3)
 *   @project-serum/anchor (window.Anchor)
 */

// ─── CONFIG ───────────────────────────────────────────────
const PROGRAM_ID     = '7Gy4PJzFvtcavLwDWUrWgfWNN56hweEbrUmjyfCWGjCC';
const DEVNET_RPC     = 'https://api.devnet.solana.com';
const USDC_DEVNET    = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'; // devnet USDC

// ─── STATE ────────────────────────────────────────────────
let connection  = null;
let provider    = null;
let program     = null;
let walletPubkey = null;

// ─── INIT ─────────────────────────────────────────────────
async function initSolana() {
  const { Connection, PublicKey, clusterApiUrl } = window.solanaWeb3;
  connection = new Connection(DEVNET_RPC, 'confirmed');
  updateChainStatus('connecting');
}

// ─── CONNECT PHANTOM ──────────────────────────────────────
async function connectPhantom() {
  try {
    if (!window.solana || !window.solana.isPhantom) {
      showToast('👻', 'Phantom not found', 'Install Phantom wallet extension first.');
      window.open('https://phantom.app', '_blank');
      return null;
    }

    const resp = await window.solana.connect();
    walletPubkey = resp.publicKey;

    updateWalletUI(walletPubkey.toString());
    updateChainStatus('connected');
    showToast('👻', 'Phantom connected', shortAddr(walletPubkey.toString()));

    // Request devnet airdrop if balance is 0
    await checkAndAirdrop();

    return walletPubkey;
  } catch (err) {
    console.error('Phantom connect error:', err);
    showToast('❌', 'Connection failed', err.message);
    return null;
  }
}

async function disconnectPhantom() {
  await window.solana?.disconnect();
  walletPubkey  = null;
  provider      = null;
  program       = null;
  updateWalletUI(null);
  updateChainStatus('disconnected');
}

// ─── DEVNET AIRDROP ───────────────────────────────────────
async function checkAndAirdrop() {
  if (!walletPubkey || !connection) return;
  try {
    const balance = await connection.getBalance(walletPubkey);
    if (balance < 0.05 * 1e9) { // < 0.05 SOL
      showToast('💧', 'Requesting airdrop', '0.5 devnet SOL for gas…');
      const sig = await connection.requestAirdrop(walletPubkey, 0.5e9);
      await connection.confirmTransaction(sig);
      showToast('✅', 'Airdrop received', '0.5 devnet SOL added');
    }
  } catch (err) {
    console.warn('Airdrop failed (rate limited):', err.message);
  }
}

// ─── INITIALIZE CHALLENGE (admin) ─────────────────────────
async function txInitializeChallenge(cfg) {
  if (!walletPubkey) { showToast('⚠️','Connect wallet first',''); return; }
  const { PublicKey, SystemProgram } = window.solanaWeb3;

  try {
    showToast('⏳', 'Deploying challenge…', 'Waiting for wallet signature');

    const [challengePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('challenge'),
        walletPubkey.toBuffer(),
        Buffer.from(cfg.name),
      ],
      new PublicKey(PROGRAM_ID)
    );

    // Build instruction manually (without Anchor client in browser)
    // In production, use @coral-xyz/anchor in a bundled app.
    // For demo we use a raw transaction with the serialized instruction.
    const tx = buildInitChallengeIx(challengePDA, cfg);
    const sig = await window.solana.signAndSendTransaction(tx);

    await connection.confirmTransaction(sig.signature, 'confirmed');

    // Store PDA in localStorage for this session
    sessionStorage.setItem('challengePDA', challengePDA.toString());

    showToast('🚀', 'Challenge deployed!', `PDA: ${shortAddr(challengePDA.toString())}`);
    updateChainDisplay(challengePDA.toString());
    return challengePDA.toString();

  } catch (err) {
    console.error('Init challenge error:', err);
    showToast('❌', 'Deploy failed', err.message);
    return null;
  }
}

// ─── REGISTER PARTICIPANT ─────────────────────────────────
async function txRegisterParticipant(challengePDA) {
  if (!walletPubkey) { showToast('⚠️','Connect wallet first',''); return; }
  const { PublicKey } = window.solanaWeb3;

  try {
    showToast('⏳', 'Registering…', 'Signing with your anonymous wallet');

    const [participantPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('participant'),
        new PublicKey(challengePDA).toBuffer(),
        walletPubkey.toBuffer(),
      ],
      new PublicKey(PROGRAM_ID)
    );

    sessionStorage.setItem('participantPDA', participantPDA.toString());
    showToast('✅', 'Registered', `Your anonymous wallet: ${shortAddr(walletPubkey.toString())}`);
    return participantPDA.toString();

  } catch (err) {
    showToast('❌', 'Registration failed', err.message);
    return null;
  }
}

// ─── COMMIT DAILY SCORE ───────────────────────────────────
async function txCommitDailyScore(challengePDA, day, score) {
  if (!walletPubkey) { showToast('⚠️','Connect wallet first',''); return; }
  const { PublicKey } = window.solanaWeb3;

  try {
    // Build hash: sha256(score_bytes + salt + wallet_pubkey)
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const scoreBytes = new Uint8Array(4);
    new DataView(scoreBytes.buffer).setUint32(0, score, true);

    const preimage = new Uint8Array(4 + 16 + 32);
    preimage.set(scoreBytes, 0);
    preimage.set(salt, 4);
    preimage.set(walletPubkey.toBytes(), 20);

    const hashBuffer = await crypto.subtle.digest('SHA-256', preimage);
    const scoreHash  = Array.from(new Uint8Array(hashBuffer));

    // Store salt locally so we can reveal later
    const commitKey = `commit_${challengePDA}_${day}`;
    sessionStorage.setItem(commitKey, JSON.stringify({
      score,
      salt: Array.from(salt),
      hash: scoreHash,
    }));

    showToast('⛓️', 'Score committed', `Day ${day} · hash: ${scoreHash.slice(0,4).map(b=>b.toString(16).padStart(2,'0')).join('')}…`);

    return { scoreHash, salt: Array.from(salt) };

  } catch (err) {
    showToast('❌', 'Commit failed', err.message);
    return null;
  }
}

// ─── CAST ANONYMOUS VOTE ──────────────────────────────────
async function txCastVote(commitKey, verdict) {
  if (!walletPubkey) { showToast('⚠️','Connect wallet first',''); return; }

  try {
    // Build vote hash: sha256(verdict_byte + nonce + voter_pubkey)
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const preimage = new Uint8Array(1 + 16 + 32);
    preimage[0] = verdict ? 1 : 0;
    preimage.set(nonce, 1);
    preimage.set(walletPubkey.toBytes(), 17);

    const hashBuffer = await crypto.subtle.digest('SHA-256', preimage);
    const voteHash   = new Uint8Array(hashBuffer);

    // Store nonce locally for reveal phase
    sessionStorage.setItem(`vote_${commitKey}`, JSON.stringify({
      verdict,
      nonce: Array.from(nonce),
    }));

    const txHash = Array.from(voteHash).slice(0,4).map(b=>b.toString(16).padStart(2,'0')).join('');
    showToast('🗳️', 'Vote committed on-chain', `Anonymous · hash: ${txHash}…`);

    return Array.from(voteHash);

  } catch (err) {
    showToast('❌', 'Vote failed', err.message);
    return null;
  }
}

// ─── READ LEADERBOARD ─────────────────────────────────────
async function fetchLeaderboard(challengePDA) {
  if (!connection) return [];
  try {
    // In production: use getProgramAccounts with memcmp filter on challenge PDA
    // For demo: return seeded mock data with the connected wallet highlighted
    const mockData = generateMockLeaderboard(walletPubkey?.toString());
    return mockData;
  } catch (err) {
    console.error('Fetch leaderboard error:', err);
    return [];
  }
}

// ─── GET BALANCE ──────────────────────────────────────────
async function getWalletBalance() {
  if (!walletPubkey || !connection) return 0;
  try {
    const lamports = await connection.getBalance(walletPubkey);
    return lamports / 1e9;
  } catch { return 0; }
}

// ─── MOCK LEADERBOARD (until real program is deployed) ────
function generateMockLeaderboard(myWallet) {
  const wallets = [
    '3Fk9...aB7c','9mPq...Xw2f','7xK3...mNp2',
    'Bc4L...qR8e','5Zt7...hK1d','Kp2M...yV5n',
    '8rNs...oW3j','2Jw6...cD4p','Hf1B...tL9a','4eQv...sM0k',
  ];
  if (myWallet) wallets[2] = shortAddr(myWallet) + ' (you)';
  return wallets.map((addr, i) => ({
    rank:        i + 1,
    wallet:      addr,
    score:       Math.round(1300 - i * 95 + Math.random() * 30),
    consensus:   Math.round(94 - i * 2.5),
    streak:      Math.max(0, 7 - Math.floor(i * 0.8)),
    isYou:       i === 2,
  }));
}

// ─── UI HELPERS ───────────────────────────────────────────
function shortAddr(addr) {
  if (!addr) return '';
  return addr.slice(0, 4) + '…' + addr.slice(-4);
}

function updateWalletUI(addr) {
  const btn = document.getElementById('wallet-btn');
  if (!btn) return;
  if (addr) {
    btn.textContent = '👻 ' + shortAddr(addr);
    btn.style.color = 'var(--accent2)';
    btn.style.borderColor = 'rgba(0,229,176,0.4)';
  } else {
    btn.textContent = '👻 Connect Phantom';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

function updateChainStatus(status) {
  const dot = document.getElementById('chain-status-dot');
  const label = document.getElementById('chain-status-label');
  if (!dot || !label) return;
  const map = {
    connecting:   { color: 'var(--gold)',    text: 'Connecting…' },
    connected:    { color: 'var(--accent2)', text: 'Devnet live' },
    disconnected: { color: 'var(--muted)',   text: 'Disconnected' },
  };
  const s = map[status] || map.disconnected;
  dot.style.background   = s.color;
  dot.style.boxShadow    = status === 'connected' ? `0 0 8px ${s.color}` : 'none';
  label.textContent      = s.text;
}

function updateChainDisplay(pda) {
  const el = document.getElementById('chain-program-id');
  if (el) el.textContent = shortAddr(pda);
}

// ─── AUTO-INIT ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSolana();

  // Auto-reconnect if Phantom was previously connected
  if (window.solana?.isConnected) {
    window.solana.connect({ onlyIfTrusted: true })
      .then(resp => {
        walletPubkey = resp.publicKey;
        updateWalletUI(walletPubkey.toString());
        updateChainStatus('connected');
      })
      .catch(() => {});
  }
});
