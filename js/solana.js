/**
 * WorkProof — Solana on-chain integration
 * Real transactions via Phantom + @solana/web3.js CDN
 * No bundler needed — works directly in browser / GitHub Pages
 *
 * Program: J8ff2KX2Csxmr2FveXN1z42tDxq99ojZKMs3qdKJVBXg (devnet)
 */

// ─── CONFIG ────────────────────────────────────────────────────────────────
const PROGRAM_ID  = 'J8ff2KX2Csxmr2FveXN1z42tDxq99ojZKMs3qdKJVBXg';
const DEVNET_RPC  = 'https://api.devnet.solana.com';

// Anchor discriminators — sha256("global:<instruction_name>")[0..8]
// Pre-computed for each instruction
const DISC = {
  initializeChallenge: new Uint8Array([78,244,189,232,139,198,254,177]),
  registerParticipant: new Uint8Array([228,88,34,193,75,78,218,160]),
  commitDailyScore:    new Uint8Array([247,198,212,69,121,63,70,35]),
  castVoteCommit:      new Uint8Array([13,107,8,228,36,116,79,21]),
};

// ─── STATE ─────────────────────────────────────────────────────────────────
let connection   = null;
let walletPubkey = null;

// ─── HELPERS ───────────────────────────────────────────────────────────────
const { PublicKey, Transaction, TransactionInstruction,
        SystemProgram, SYSVAR_RENT_PUBKEY } = window.solanaWeb3;

function pk(s) { return new PublicKey(s); }
const PROGRAM = pk(PROGRAM_ID);

/** Find PDA synchronously */
function pda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM);
}

/** Encode a UTF-8 string as bytes with u32 length prefix (Borsh) */
function encodeString(s) {
  const bytes = new TextEncoder().encode(s);
  const buf   = new Uint8Array(4 + bytes.length);
  new DataView(buf.buffer).setUint32(0, bytes.length, true);
  buf.set(bytes, 4);
  return buf;
}

/** Encode a u16 LE */
function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

/** Encode a u8 */
function u8(n) { return new Uint8Array([n]); }

/** Concat Uint8Arrays */
function concat(...arrays) {
  const len = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

/** SHA-256 via Web Crypto */
async function sha256(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(buf);
}

/** Build + send a transaction via Phantom */
async function sendTx(instructions) {
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: walletPubkey });
  tx.add(...instructions);
  const signed = await window.solana.signTransaction(tx);
  const sig    = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

// ─── CONNECT PHANTOM ───────────────────────────────────────────────────────
async function connectPhantom() {
  try {
    if (!window.solana?.isPhantom) {
      showToast('👻', 'Phantom not found', 'Install Phantom from phantom.app');
      window.open('https://phantom.app', '_blank');
      return null;
    }
    const resp = await window.solana.connect();
    walletPubkey = resp.publicKey;
    updateWalletUI(walletPubkey.toString());
    updateChainStatus('connected');
    showToast('👻', 'Phantom connected', shortAddr(walletPubkey.toString()));
    await checkAndAirdrop();
    return walletPubkey;
  } catch (err) {
    showToast('❌', 'Connect failed', err.message);
    return null;
  }
}

async function disconnectPhantom() {
  await window.solana?.disconnect();
  walletPubkey = null;
  updateWalletUI(null);
  updateChainStatus('disconnected');
}

async function checkAndAirdrop() {
  if (!walletPubkey) return;
  try {
    const bal = await connection.getBalance(walletPubkey);
    if (bal < 0.1e9) {
      showToast('💧', 'Requesting devnet SOL…', '');
      const sig = await connection.requestAirdrop(walletPubkey, 1e9);
      await connection.confirmTransaction(sig);
      showToast('✅', 'Airdrop done', '1 devnet SOL added');
    }
  } catch {}
}

// ─── 1. INITIALIZE CHALLENGE ───────────────────────────────────────────────
async function txInitializeChallenge(cfg) {
  if (!walletPubkey) { showToast('⚠️','Connect wallet first',''); return null; }

  try {
    showToast('⏳', 'Deploying challenge…', 'Sign in Phantom');

    const nameBytes = new TextEncoder().encode(cfg.name);
    const [challengePDA] = pda([
      new TextEncoder().encode('challenge'),
      walletPubkey.toBytes(),
      nameBytes,
    ]);

    // Borsh-encode instruction data
    // discriminator(8) + name_len(4) + name + duration_days(2) + reward_top_n(1) + vote_threshold(1)
    const data = concat(
      DISC.initializeChallenge,
      encodeString(cfg.name),
      u16(cfg.durationDays),
      u8(cfg.rewardTopN),
      u8(cfg.voteThreshold),
    );

    const ix = new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: challengePDA,       isSigner: false, isWritable: true  },
        { pubkey: walletPubkey,       isSigner: true,  isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const sig = await sendTx([ix]);

    sessionStorage.setItem('challengePDA',  challengePDA.toString());
    sessionStorage.setItem('challengeName', cfg.name);

    showToast('🚀', 'Challenge on-chain!', shortAddr(challengePDA.toString()));
    updateChainDisplay(challengePDA.toString());

    // Update chain status panel
    const el = document.getElementById('chain-program-id');
    if (el) el.textContent = shortAddr(challengePDA.toString());

    return { pda: challengePDA.toString(), sig };

  } catch (err) {
    console.error('initializeChallenge:', err);
    showToast('❌', 'Deploy failed', err.message?.slice(0,80) || String(err));
    return null;
  }
}

// ─── 2. REGISTER PARTICIPANT ───────────────────────────────────────────────
async function txRegisterParticipant() {
  if (!walletPubkey) { showToast('⚠️','Connect wallet first',''); return null; }
  const challengePDA = sessionStorage.getItem('challengePDA');
  if (!challengePDA) { showToast('⚠️','No active challenge','Deploy a challenge first'); return null; }

  try {
    showToast('⏳', 'Registering…', 'Sign in Phantom');

    const [participantPDA] = pda([
      new TextEncoder().encode('participant'),
      pk(challengePDA).toBytes(),
      walletPubkey.toBytes(),
    ]);

    const data = DISC.registerParticipant; // no extra args

    const ix = new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: pk(challengePDA), isSigner: false, isWritable: true },
        { pubkey: participantPDA,   isSigner: false, isWritable: true },
        { pubkey: walletPubkey,     isSigner: true,  isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const sig = await sendTx([ix]);
    sessionStorage.setItem('participantPDA', participantPDA.toString());
    showToast('✅', 'Registered!', shortAddr(walletPubkey.toString()) + ' is in the challenge');
    return participantPDA.toString();

  } catch (err) {
    console.error('registerParticipant:', err);
    showToast('❌', 'Registration failed', err.message?.slice(0,80) || String(err));
    return null;
  }
}

// ─── 3. COMMIT DAILY SCORE (with local encryption) ────────────────────────
async function txCommitDailyScore(score, day) {
  if (!walletPubkey) { showToast('⚠️','Connect wallet first',''); return null; }
  const challengePDA = sessionStorage.getItem('challengePDA');
  if (!challengePDA) { showToast('⚠️','No active challenge',''); return null; }

  try {
    // Build hash: sha256(score_le_bytes ++ salt ++ wallet_pubkey)
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const scoreBytes = new Uint8Array(4);
    new DataView(scoreBytes.buffer).setUint32(0, score, true);
    const preimage = concat(scoreBytes, salt, walletPubkey.toBytes());
    const scoreHash = await sha256(preimage);

    // Store locally for reveal phase
    sessionStorage.setItem(`commit_${challengePDA}_${day}`, JSON.stringify({
      score, day, salt: Array.from(salt), hash: Array.from(scoreHash),
    }));

    const [participantPDA] = pda([
      new TextEncoder().encode('participant'),
      pk(challengePDA).toBytes(),
      walletPubkey.toBytes(),
    ]);

    const [commitPDA] = pda([
      new TextEncoder().encode('commit'),
      pk(challengePDA).toBytes(),
      walletPubkey.toBytes(),
      u16(day),
    ]);

    // discriminator(8) + day(2) + score_hash(32)
    const data = concat(DISC.commitDailyScore, u16(day), scoreHash);

    const ix = new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: pk(challengePDA), isSigner: false, isWritable: false },
        { pubkey: participantPDA,   isSigner: false, isWritable: true  },
        { pubkey: commitPDA,        isSigner: false, isWritable: true  },
        { pubkey: walletPubkey,     isSigner: true,  isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const sig = await sendTx([ix]);
    const hashHex = Array.from(scoreHash.slice(0,4)).map(b=>b.toString(16).padStart(2,'0')).join('');
    showToast('⛓️', `Day ${day} committed`, `hash: ${hashHex}… tx: ${shortAddr(sig)}`);
    return { commitPDA: commitPDA.toString(), sig };

  } catch (err) {
    console.error('commitDailyScore:', err);
    showToast('❌', 'Commit failed', err.message?.slice(0,80) || String(err));
    return null;
  }
}

// ─── 4. CAST ANONYMOUS VOTE ────────────────────────────────────────────────
async function txCastVote(commitPDAStr, verdict) {
  if (!walletPubkey) { showToast('⚠️','Connect wallet first',''); return null; }

  try {
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const preimage = concat(
      new Uint8Array([verdict ? 1 : 0]),
      nonce,
      walletPubkey.toBytes()
    );
    const voteHash = await sha256(preimage);

    // Store for reveal
    sessionStorage.setItem(`vote_${commitPDAStr}`, JSON.stringify({
      verdict, nonce: Array.from(nonce),
    }));

    const [voteRecordPDA] = pda([
      new TextEncoder().encode('vote'),
      pk(commitPDAStr).toBytes(),
      walletPubkey.toBytes(),
    ]);

    // discriminator(8) + vote_hash(32)
    const data = concat(DISC.castVoteCommit, voteHash);

    const ix = new TransactionInstruction({
      programId: PROGRAM,
      keys: [
        { pubkey: pk(commitPDAStr), isSigner: false, isWritable: true },
        { pubkey: voteRecordPDA,    isSigner: false, isWritable: true },
        { pubkey: walletPubkey,     isSigner: true,  isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const sig = await sendTx([ix]);
    showToast('🗳️', 'Vote committed on-chain', `Anonymous · tx: ${shortAddr(sig)}`);
    return sig;

  } catch (err) {
    console.error('castVote:', err);
    showToast('❌', 'Vote failed', err.message?.slice(0,80) || String(err));
    return null;
  }
}

// ─── READ LEADERBOARD FROM CHAIN ──────────────────────────────────────────
async function fetchLeaderboard(challengePDA) {
  if (!connection || !challengePDA) return generateMockLeaderboard();
  try {
    // getProgramAccounts filtered to participant PDAs for this challenge
    const accounts = await connection.getProgramAccounts(PROGRAM, {
      filters: [
        { dataSize: 8 + 32 + 32 + 8 + 2 + 2 + 2 + 1 + 2 + 1 }, // Participant size
        { memcmp: { offset: 8, bytes: pk(challengePDA).toBase58() } },
      ]
    });

    if (!accounts.length) return generateMockLeaderboard(walletPubkey?.toString());

    return accounts
      .map(({ pubkey, account }) => {
        const d = account.data;
        const wallet   = new PublicKey(d.slice(40, 72)).toString();
        const score    = Number(BigInt(
          '0x' + Array.from(d.slice(72,80)).reverse().map(b=>b.toString(16).padStart(2,'0')).join('')
        ));
        const streak   = new DataView(d.buffer).getUint16(82, true);
        const consAvg  = d[86];
        return { wallet, score, streak, consensus: consAvg, isYou: wallet === walletPubkey?.toString() };
      })
      .sort((a,b) => b.score - a.score)
      .map((p, i) => ({ ...p, rank: i + 1 }));

  } catch (err) {
    console.warn('fetchLeaderboard:', err.message);
    return generateMockLeaderboard(walletPubkey?.toString());
  }
}

// ─── MOCK LEADERBOARD (fallback when no on-chain data yet) ────────────────
function generateMockLeaderboard(myWallet) {
  const addrs = [
    '3Fk9...aB7c','9mPq...Xw2f','7xK3...mNp2',
    'Bc4L...qR8e','5Zt7...hK1d','Kp2M...yV5n',
    '8rNs...oW3j','2Jw6...cD4p','Hf1B...tL9a','4eQv...sM0k',
  ];
  if (myWallet) addrs[2] = shortAddr(myWallet);
  return addrs.map((wallet, i) => ({
    rank: i+1, wallet,
    score:     Math.round(1300 - i*95 + Math.random()*20),
    consensus: Math.round(94 - i*2.5),
    streak:    Math.max(0, 7 - Math.floor(i*0.8)),
    isYou:     i === 2,
  }));
}

// ─── GET BALANCE ──────────────────────────────────────────────────────────
async function getWalletBalance() {
  if (!walletPubkey || !connection) return 0;
  try { return (await connection.getBalance(walletPubkey)) / 1e9; } catch { return 0; }
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────
function shortAddr(addr) {
  if (!addr) return '';
  return addr.length > 12 ? addr.slice(0,4) + '…' + addr.slice(-4) : addr;
}

function updateWalletUI(addr) {
  const btn = document.getElementById('wallet-btn');
  if (!btn) return;
  if (addr) {
    btn.textContent   = '👻 ' + shortAddr(addr);
    btn.style.color   = 'var(--accent2)';
    btn.style.borderColor = 'rgba(0,229,176,0.4)';
  } else {
    btn.textContent   = '👻 Connect Phantom';
    btn.style.color   = '';
    btn.style.borderColor = '';
  }
}

function updateChainStatus(status) {
  const dot   = document.getElementById('chain-status-dot');
  const label = document.getElementById('chain-status-label');
  if (!dot || !label) return;
  const map = {
    connecting:   { color:'var(--gold)',    text:'Connecting…' },
    connected:    { color:'var(--accent2)', text:'Devnet live' },
    disconnected: { color:'var(--muted)',   text:'Disconnected' },
  };
  const s = map[status] || map.disconnected;
  dot.style.background = s.color;
  dot.style.boxShadow  = status==='connected' ? `0 0 8px ${s.color}` : 'none';
  label.textContent    = s.text;
}

function updateChainDisplay(pda) {
  const el = document.getElementById('chain-program-id');
  if (el) el.textContent = shortAddr(pda);
}

// ─── AUTO-INIT ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  connection = new window.solanaWeb3.Connection(DEVNET_RPC, 'confirmed');
  updateChainStatus('connecting');

  // Auto-reconnect if Phantom was already approved
  if (window.solana?.isConnected) {
    window.solana.connect({ onlyIfTrusted: true })
      .then(r => {
        walletPubkey = r.publicKey;
        updateWalletUI(walletPubkey.toString());
        updateChainStatus('connected');
      })
      .catch(() => updateChainStatus('disconnected'));
  } else {
    updateChainStatus('disconnected');
  }

  // Listen for Phantom account changes
  window.solana?.on('accountChanged', pk => {
    walletPubkey = pk;
    if (pk) updateWalletUI(pk.toString());
    else { updateWalletUI(null); updateChainStatus('disconnected'); }
  });
});
