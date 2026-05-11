/**
 * WorkProof — Solana integration v2
 * Correct Anchor discriminators + Google Calendar OAuth
 * Program: J8ff2KX2Csxmr2FveXN1z42tDxq99ojZKMs3qdKJVBXg (devnet)
 */

// ─── CONFIG ────────────────────────────────────────────────
const PROGRAM_ID = 'J8ff2KX2Csxmr2FveXN1z42tDxq99ojZKMs3qdKJVBXg';
const DEVNET_RPC = 'https://api.devnet.solana.com';

// Correct Anchor discriminators: sha256("global:<name>")[0..8]
const DISC = {
  initializeChallenge: new Uint8Array([131,92,76,227,13,71,164,243]),
  registerParticipant: new Uint8Array([248,112,38,215,226,230,249,40]),
  commitDailyScore:    new Uint8Array([205,75,203,172,134,24,50,155]),
  castVoteCommit:      new Uint8Array([194,191,145,3,180,121,37,87]),
};

// ─── STATE ─────────────────────────────────────────────────
let connection   = null;
let walletPubkey = null;
let _calendarToken = null; // Google OAuth token

// ─── SOLANA HELPERS ────────────────────────────────────────
function pk(s) { return new window.solanaWeb3.PublicKey(s); }
const PROGRAM = () => pk(PROGRAM_ID);

function pda(seeds) {
  return window.solanaWeb3.PublicKey.findProgramAddressSync(seeds, PROGRAM());
}

function encodeString(s) {
  const b = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
}

function u16le(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function concat(...arrays) {
  const len = arrays.reduce((s,a) => s+a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function sendTx(instructions) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const { Transaction } = window.solanaWeb3;
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: walletPubkey });
  tx.add(...instructions);
  const signed = await window.solana.signTransaction(tx);
  console.log('Sending tx…');
  let sig;
  try {
    sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
  } catch(sendErr) {
    // Attach logs to error for better debugging
    if (sendErr.logs) sendErr.message += ' | logs: ' + sendErr.logs.join(' | ');
    throw sendErr;
  }
  console.log('Tx sent:', sig);
  const result = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (result.value.err) {
    const err = new Error('Transaction failed: ' + JSON.stringify(result.value.err));
    // Fetch logs
    try {
      const txInfo = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
      err.logs = txInfo?.meta?.logMessages || [];
      console.error('Tx logs:', err.logs);
    } catch {}
    throw err;
  }
  return sig;
}

// ─── PHANTOM ───────────────────────────────────────────────
async function connectPhantom() {
  try {
    if (!window.solana?.isPhantom) {
      showToast('👻','Phantom not found','Install from phantom.app');
      window.open('https://phantom.app','_blank');
      return null;
    }
    const resp = await window.solana.connect();
    walletPubkey = resp.publicKey;
    updateWalletUI(walletPubkey.toString());
    updateChainStatus('connected');
    showToast('👻','Phantom connected', shortAddr(walletPubkey.toString()));
    await checkAndAirdrop();
    return walletPubkey;
  } catch(e) {
    showToast('❌','Connect failed', e.message);
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
      showToast('💧','Requesting devnet SOL…','');
      const sig = await connection.requestAirdrop(walletPubkey, 1e9);
      await connection.confirmTransaction(sig);
      showToast('✅','Airdrop done','1 devnet SOL added');
    }
  } catch {}
}

// ─── 1. INITIALIZE CHALLENGE ───────────────────────────────
async function txInitializeChallenge(cfg) {
  if (!walletPubkey) { showToast('⚠️','Connect Phantom first',''); return null; }

  showToast('⏳','Deploying challenge…','Waiting for Phantom signature…');

  try {
    // PDA seed name capped at 32 bytes to stay within Solana seed limits
    const nameRaw   = cfg.name.slice(0, 32);
    const nameBytes = new TextEncoder().encode(nameRaw);
    const [challengePDA] = pda([
      new TextEncoder().encode('challenge'),
      walletPubkey.toBytes(),
      nameBytes,
    ]);
    console.log('Challenge PDA:', challengePDA.toString(), 'name:', nameRaw);

    // Borsh: disc(8) + name_str(4+n) + duration_days(u16) + reward_top_n(u8) + vote_threshold(u8)
    const data = concat(
      DISC.initializeChallenge,
      encodeString(cfg.name),
      u16le(cfg.durationDays),
      new Uint8Array([cfg.rewardTopN]),
      new Uint8Array([cfg.voteThreshold]),
    );

    const { TransactionInstruction, SystemProgram } = window.solanaWeb3;
    const ix = new TransactionInstruction({
      programId: PROGRAM(),
      keys: [
        { pubkey: challengePDA,              isSigner:false, isWritable:true  },
        { pubkey: walletPubkey,              isSigner:true,  isWritable:true  },
        { pubkey: SystemProgram.programId,   isSigner:false, isWritable:false },
      ],
      data,
    });

    const sig = await sendTx([ix]);

    sessionStorage.setItem('challengePDA',  challengePDA.toString());
    sessionStorage.setItem('challengeName', cfg.name);

    showToast('🚀','Challenge deployed on-chain!',
      `PDA: ${shortAddr(challengePDA.toString())} · tx: ${shortAddr(sig)}`);
    updateChainDisplay(challengePDA.toString());
    return { pda: challengePDA.toString(), sig };

  } catch(e) {
    console.error('initializeChallenge full error:', e);
    // Parse Solana program errors
    let msg = e.message || String(e);
    if (e.logs) {
      console.error('Program logs:', e.logs);
      const logMsg = e.logs.find(l => l.includes('Error') || l.includes('error'));
      if (logMsg) msg = logMsg.replace('Program log: ','');
    }
    // Common fixes
    if (msg.includes('already in use') || msg.includes('0x0')) {
      msg = 'Challenge name already used — try a different name';
    } else if (msg.includes('insufficient')) {
      msg = 'Insufficient SOL for transaction fees';
    } else if (msg.includes('0x')) {
      msg = 'Program error: ' + msg.match(/0x[0-9a-f]+/i)?.[0] + ' — see console';
    }
    showToast('❌','Deploy failed', msg.slice(0,100));
    return null;
  }
}

// ─── 2. REGISTER PARTICIPANT ───────────────────────────────
async function txRegisterParticipant() {
  if (!walletPubkey) { showToast('⚠️','Connect Phantom first',''); return null; }
  const challengePDA = sessionStorage.getItem('challengePDA');
  if (!challengePDA) { showToast('⚠️','No challenge','Deploy a challenge first'); return null; }

  showToast('⏳','Registering…','Sign in Phantom');
  try {
    const [participantPDA] = pda([
      new TextEncoder().encode('participant'),
      pk(challengePDA).toBytes(),
      walletPubkey.toBytes(),
    ]);

    const { TransactionInstruction, SystemProgram } = window.solanaWeb3;
    const ix = new TransactionInstruction({
      programId: PROGRAM(),
      keys: [
        { pubkey: pk(challengePDA), isSigner:false, isWritable:true  },
        { pubkey: participantPDA,   isSigner:false, isWritable:true  },
        { pubkey: walletPubkey,     isSigner:true,  isWritable:true  },
        { pubkey: SystemProgram.programId, isSigner:false, isWritable:false },
      ],
      data: DISC.registerParticipant,
    });

    const sig = await sendTx([ix]);
    sessionStorage.setItem('participantPDA', participantPDA.toString());
    showToast('✅','Registered!', `Wallet: ${shortAddr(walletPubkey.toString())} · tx: ${shortAddr(sig)}`);
    return participantPDA.toString();
  } catch(e) {
    console.error('register:', e);
    showToast('❌','Registration failed', e.message?.slice(0,80) || String(e));
    return null;
  }
}

// ─── 3. COMMIT DAILY SCORE ─────────────────────────────────
async function txCommitDailyScore(score, day) {
  if (!walletPubkey) { showToast('⚠️','Connect Phantom first',''); return null; }
  const challengePDA = sessionStorage.getItem('challengePDA');
  if (!challengePDA) { showToast('⚠️','No challenge','Deploy first'); return null; }

  showToast('⏳','Committing score…','Hashing locally, signing in Phantom');
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const scoreBytes = new Uint8Array(4);
    new DataView(scoreBytes.buffer).setUint32(0, score, true);
    const preimage = concat(scoreBytes, salt, walletPubkey.toBytes());
    const scoreHash = await sha256(preimage);

    sessionStorage.setItem(`commit_${challengePDA}_${day}`, JSON.stringify({
      score, day, salt: Array.from(salt), hash: Array.from(scoreHash),
    }));

    const [participantPDA] = pda([
      new TextEncoder().encode('participant'),
      pk(challengePDA).toBytes(), walletPubkey.toBytes(),
    ]);
    const [commitPDA] = pda([
      new TextEncoder().encode('commit'),
      pk(challengePDA).toBytes(), walletPubkey.toBytes(), u16le(day),
    ]);

    const data = concat(DISC.commitDailyScore, u16le(day), scoreHash);

    const { TransactionInstruction, SystemProgram } = window.solanaWeb3;
    const ix = new TransactionInstruction({
      programId: PROGRAM(),
      keys: [
        { pubkey: pk(challengePDA), isSigner:false, isWritable:false },
        { pubkey: participantPDA,   isSigner:false, isWritable:true  },
        { pubkey: commitPDA,        isSigner:false, isWritable:true  },
        { pubkey: walletPubkey,     isSigner:true,  isWritable:true  },
        { pubkey: SystemProgram.programId, isSigner:false, isWritable:false },
      ],
      data,
    });

    const sig = await sendTx([ix]);
    const hex = Array.from(scoreHash.slice(0,4)).map(b=>b.toString(16).padStart(2,'0')).join('');
    showToast('⛓️',`Day ${day} committed on-chain`,`score: ${score} · hash: ${hex}… · tx: ${shortAddr(sig)}`);
    return { commitPDA: commitPDA.toString(), sig };
  } catch(e) {
    console.error('commit:', e);
    showToast('❌','Commit failed', e.message?.slice(0,80)||String(e));
    return null;
  }
}

// ─── 4. ANONYMOUS VOTE ─────────────────────────────────────
async function txCastVote(commitPDAStr, verdict) {
  if (!walletPubkey) { showToast('⚠️','Connect Phantom first',''); return null; }
  showToast('⏳','Casting vote…','Anonymous · signing in Phantom');
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const preimage = concat(new Uint8Array([verdict?1:0]), nonce, walletPubkey.toBytes());
    const voteHash = await sha256(preimage);

    sessionStorage.setItem(`vote_${commitPDAStr}`, JSON.stringify({ verdict, nonce: Array.from(nonce) }));

    const [voteRecordPDA] = pda([
      new TextEncoder().encode('vote'),
      pk(commitPDAStr).toBytes(), walletPubkey.toBytes(),
    ]);

    const { TransactionInstruction, SystemProgram } = window.solanaWeb3;
    const ix = new TransactionInstruction({
      programId: PROGRAM(),
      keys: [
        { pubkey: pk(commitPDAStr), isSigner:false, isWritable:true },
        { pubkey: voteRecordPDA,    isSigner:false, isWritable:true },
        { pubkey: walletPubkey,     isSigner:true,  isWritable:true },
        { pubkey: SystemProgram.programId, isSigner:false, isWritable:false },
      ],
      data: concat(DISC.castVoteCommit, voteHash),
    });

    const sig = await sendTx([ix]);
    showToast('🗳️','Vote on-chain!',`Anonymous · tx: ${shortAddr(sig)}`);
    return sig;
  } catch(e) {
    console.error('vote:', e);
    showToast('❌','Vote failed', e.message?.slice(0,80)||String(e));
    return null;
  }
}

// ─── GOOGLE CALENDAR INTEGRATION ───────────────────────────
const GCAL_CLIENT_ID = '66127663594-3dk1gr1c9cnnj96mmhl7jkolkk7hjd0u.apps.googleusercontent.com'; // set in settings
const GCAL_SCOPES    = 'https://www.googleapis.com/auth/calendar.readonly';

function connectGoogleCalendar() {
  if (!window.google?.accounts?.oauth2) {
    showToast('❌','Google API not loaded','Check internet connection');
    return;
  }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GCAL_CLIENT_ID,
    scope:     GCAL_SCOPES,
    callback:  (resp) => {
      if (resp.error) { showToast('❌','Google auth failed', resp.error); return; }
      _calendarToken = resp.access_token;
      showToast('📅','Google Calendar connected','Fetching today\'s meetings…');
      fetchCalendarActivity().then(updateActivityDisplay);
    },
  });
  client.requestAccessToken();
}

async function fetchCalendarActivity() {
  if (!_calendarToken) return null;

  const now   = new Date();
  const start = new Date(now); start.setHours(0,0,0,0);
  const end   = new Date(now); end.setHours(23,59,59,999);

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      `timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true`,
      { headers: { Authorization: `Bearer ${_calendarToken}` } }
    );
    const data = await res.json();
    const events = data.items || [];

    const activity = {
      meetings:    events.filter(e => e.attendees?.length > 1).length,
      totalEvents: events.length,
      source:      'Google Calendar',
      date:        now.toISOString().slice(0,10),
    };

    sessionStorage.setItem('today_activity', JSON.stringify(activity));
    return activity;
  } catch(e) {
    console.error('Calendar fetch:', e);
    return null;
  }
}

function updateActivityDisplay(activity) {
  if (!activity) return;

  // Update wizard step 3 chips (if still in setup)
  const el = document.getElementById('gcal-activity');
  if (el) {
    el.innerHTML =
      '<div class="chip">📅 Meetings <span class="chip-val">'+activity.meetings+'</span></div>' +
      '<div class="chip">📆 Total events <span class="chip-val">'+activity.totalEvents+'</span></div>' +
      '<div class="chip" style="border-color:rgba(0,229,176,0.4);color:var(--accent2)">✓ '+activity.source+'</div>';
  }

  // Update sidebar button
  const btn = document.getElementById('gcal-btn');
  if (btn) {
    btn.textContent = '📅 ' + activity.meetings + ' meetings today';
    btn.style.color = 'var(--accent2)';
    btn.style.borderColor = 'rgba(0,229,176,0.4)';
  }

  // Rebuild vote cards with live data
  if (typeof buildVoteCards === 'function') buildVoteCards();

  // Compute score from real data
  const score = Math.round(activity.meetings * 25 + activity.totalEvents * 10 + Math.random() * 20);
  sessionStorage.setItem('today_computed_score', score.toString());
  showToast('📅', activity.meetings + ' meetings today',
    'Score: ' + score + ' pts — ready to commit on-chain');
}

// ─── LEADERBOARD FROM CHAIN ────────────────────────────────
async function fetchLeaderboard() {
  const challengePDA = sessionStorage.getItem('challengePDA');
  if (!connection || !challengePDA) return generateMockLeaderboard();
  try {
    const accounts = await connection.getProgramAccounts(PROGRAM(), {
      filters: [
        { dataSize: 8+32+32+8+2+2+2+1+2+1 },
        { memcmp: { offset: 8, bytes: pk(challengePDA).toBase58() } },
      ]
    });
    if (!accounts.length) return generateMockLeaderboard();
    return accounts
      .map(({ account: { data } }) => {
        const wallet  = new window.solanaWeb3.PublicKey(data.slice(40,72)).toString();
        const dv      = new DataView(data.buffer, data.byteOffset);
        const score   = Number(dv.getBigUint64(72, true));
        const streak  = dv.getUint16(82, true);
        const consAvg = data[86];
        return { wallet, score, streak, consensus: consAvg, isYou: wallet === walletPubkey?.toString() };
      })
      .sort((a,b) => b.score - a.score)
      .map((p,i) => ({ ...p, rank: i+1 }));
  } catch(e) {
    console.warn('leaderboard fetch:', e.message);
    return generateMockLeaderboard();
  }
}

function generateMockLeaderboard() {
  const addrs = ['3Fk9...aB7c','9mPq...Xw2f','7xK3...mNp2','Bc4L...qR8e','5Zt7...hK1d',
                 'Kp2M...yV5n','8rNs...oW3j','2Jw6...cD4p','Hf1B...tL9a','4eQv...sM0k'];
  if (walletPubkey) addrs[2] = shortAddr(walletPubkey.toString());
  return addrs.map((wallet,i) => ({
    rank:i+1, wallet,
    score:     Math.round(1300-i*95+Math.random()*20),
    consensus: Math.round(94-i*2.5),
    streak:    Math.max(0,7-Math.floor(i*0.8)),
    isYou:     i===2,
  }));
}

// ─── UI ────────────────────────────────────────────────────
function shortAddr(a) { return a?.length>12 ? a.slice(0,4)+'…'+a.slice(-4) : (a||''); }

function updateWalletUI(addr) {
  const btn = document.getElementById('wallet-btn');
  if (!btn) return;
  if (addr) {
    btn.textContent = '👻 '+shortAddr(addr);
    btn.style.color = 'var(--accent2)';
    btn.style.borderColor = 'rgba(0,229,176,0.4)';
  } else {
    btn.textContent = '👻 Connect Phantom';
    btn.style.color = btn.style.borderColor = '';
  }
}

function updateChainStatus(s) {
  const dot   = document.getElementById('chain-status-dot');
  const label = document.getElementById('chain-status-label');
  if (!dot||!label) return;
  const m = { connecting:{color:'var(--gold)',text:'Connecting…'},
               connected: {color:'var(--accent2)',text:'Devnet live'},
               disconnected:{color:'var(--muted)',text:'Disconnected'} };
  const v = m[s]||m.disconnected;
  dot.style.background = v.color;
  dot.style.boxShadow  = s==='connected'?`0 0 8px ${v.color}`:'none';
  label.textContent    = v.text;
}

function updateChainDisplay(pda) {
  const el = document.getElementById('chain-program-id');
  if (el) el.textContent = shortAddr(pda);
}

// ─── AUTO INIT ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  connection = new window.solanaWeb3.Connection(DEVNET_RPC, 'confirmed');
  updateChainStatus('disconnected');

  if (window.solana?.isConnected) {
    window.solana.connect({ onlyIfTrusted: true })
      .then(r => { walletPubkey = r.publicKey; updateWalletUI(walletPubkey.toString()); updateChainStatus('connected'); })
      .catch(() => {});
  }

  window.solana?.on('accountChanged', p => {
    walletPubkey = p;
    updateWalletUI(p?.toString()||null);
    if (!p) updateChainStatus('disconnected');
  });
});
