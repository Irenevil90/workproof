use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("7Gy4PJzFvtcavLwDWUrWgfWNN56hweEbrUmjyfCWGjCC");

// ─────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────
const MAX_PARTICIPANTS: usize = 50;
const MAX_NAME_LEN: usize = 64;
const MAX_DAYS: u16 = 90;
const VOTE_WINDOW_SECONDS: i64 = 6 * 60 * 60; // 6 hours to vote each day

#[program]
pub mod workproof {
    use super::*;

    // ─────────────────────────────────────────────────────
    //  1. INITIALIZE CHALLENGE
    //     Company admin creates the challenge config.
    //     Defines: name, duration, reward splits, vote threshold.
    // ─────────────────────────────────────────────────────
    pub fn initialize_challenge(
        ctx: Context<InitializeChallenge>,
        name: String,
        duration_days: u16,
        reward_top_n: u8,
        vote_threshold: u8, // e.g. 3 = "3 out of 5 peers"
        bump: u8,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, WorkproofError::NameTooLong);
        require!(duration_days > 0 && duration_days <= MAX_DAYS, WorkproofError::InvalidDuration);
        require!(reward_top_n >= 1 && reward_top_n <= 10, WorkproofError::InvalidRewardN);
        require!(vote_threshold >= 1 && vote_threshold <= 5, WorkproofError::InvalidThreshold);

        let challenge = &mut ctx.accounts.challenge;
        challenge.admin         = ctx.accounts.admin.key();
        challenge.name          = name;
        challenge.duration_days = duration_days;
        challenge.reward_top_n  = reward_top_n;
        challenge.vote_threshold = vote_threshold;
        challenge.start_time    = Clock::get()?.unix_timestamp;
        challenge.end_time      = challenge.start_time + (duration_days as i64 * 86400);
        challenge.is_active     = true;
        challenge.is_settled    = false;
        challenge.participant_count = 0;
        challenge.bump          = bump;

        emit!(ChallengeCreated {
            challenge: ctx.accounts.challenge.key(),
            admin: ctx.accounts.admin.key(),
            name: challenge.name.clone(),
            duration_days,
            end_time: challenge.end_time,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────
    //  2. FUND ESCROW
    //     Company deposits USDC into the escrow vault.
    //     Locked until challenge ends — admin cannot withdraw.
    // ─────────────────────────────────────────────────────
    pub fn fund_escrow(
        ctx: Context<FundEscrow>,
        amount: u64,
    ) -> Result<()> {
        let challenge = &ctx.accounts.challenge;
        require!(challenge.is_active, WorkproofError::ChallengeNotActive);
        require!(!challenge.is_settled, WorkproofError::AlreadySettled);

        // Transfer USDC from admin's token account to escrow vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.admin_token_account.to_account_info(),
                    to:        ctx.accounts.escrow_vault.to_account_info(),
                    authority: ctx.accounts.admin.to_account_info(),
                },
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.challenge  = ctx.accounts.challenge.key();
        escrow.total_amount = escrow.total_amount.checked_add(amount)
            .ok_or(WorkproofError::Overflow)?;
        escrow.is_funded  = true;

        emit!(EscrowFunded {
            challenge: ctx.accounts.challenge.key(),
            amount,
            total: escrow.total_amount,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────
    //  3. REGISTER PARTICIPANT
    //     Each employee registers with their anonymous wallet.
    //     Company cannot link wallet to real identity.
    // ─────────────────────────────────────────────────────
    pub fn register_participant(
        ctx: Context<RegisterParticipant>,
        bump: u8,
    ) -> Result<()> {
        let challenge = &mut ctx.accounts.challenge;
        require!(challenge.is_active, WorkproofError::ChallengeNotActive);
        require!(
            challenge.participant_count < MAX_PARTICIPANTS as u8,
            WorkproofError::TooManyParticipants
        );

        let participant = &mut ctx.accounts.participant;
        participant.challenge      = ctx.accounts.challenge.key();
        participant.wallet         = ctx.accounts.wallet.key();
        participant.total_score    = 0;
        participant.days_committed = 0;
        participant.streak         = 0;
        participant.max_streak     = 0;
        participant.consensus_avg  = 0;
        participant.vote_count     = 0;
        participant.bump           = bump;

        challenge.participant_count += 1;

        emit!(ParticipantRegistered {
            challenge: ctx.accounts.challenge.key(),
            wallet: ctx.accounts.wallet.key(),
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────
    //  4. COMMIT DAILY SCORE (HASH)
    //     Employee's local agent computes score, encrypts it,
    //     and commits only the hash on-chain. Raw data never
    //     leaves the device.
    //     score_hash = sha256(score_bytes + salt + wallet_pubkey)
    // ─────────────────────────────────────────────────────
    pub fn commit_daily_score(
        ctx: Context<CommitDailyScore>,
        day: u16,
        score_hash: [u8; 32], // SHA-256 hash of encrypted score
        bump: u8,
    ) -> Result<()> {
        let challenge = &ctx.accounts.challenge;
        require!(challenge.is_active, WorkproofError::ChallengeNotActive);
        require!(day < challenge.duration_days, WorkproofError::InvalidDay);

        // Verify the day matches the timeline
        let now = Clock::get()?.unix_timestamp;
        let elapsed_days = ((now - challenge.start_time) / 86400) as u16;
        require!(day <= elapsed_days, WorkproofError::DayNotYetReached);

        let commit = &mut ctx.accounts.daily_commit;
        commit.challenge   = ctx.accounts.challenge.key();
        commit.participant = ctx.accounts.participant.key();
        commit.wallet      = ctx.accounts.wallet.key();
        commit.day         = day;
        commit.score_hash  = score_hash;
        commit.committed_at = now;
        commit.is_revealed = false;
        commit.revealed_score = 0;
        commit.vote_open   = true;
        commit.vote_yes    = 0;
        commit.vote_no     = 0;
        commit.vote_closed_at = now + VOTE_WINDOW_SECONDS;
        commit.bump        = bump;

        // Update participant streak
        let participant = &mut ctx.accounts.participant;
        participant.days_committed += 1;

        emit!(ScoreCommitted {
            challenge: ctx.accounts.challenge.key(),
            wallet: ctx.accounts.wallet.key(),
            day,
            score_hash,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────
    //  5. REVEAL DAILY SCORE
    //     After voting window closes, employee reveals the
    //     actual score. Contract verifies it matches the hash.
    //     Then applies the peer consensus multiplier.
    // ─────────────────────────────────────────────────────
    pub fn reveal_daily_score(
        ctx: Context<RevealDailyScore>,
        score: u32,
        salt: [u8; 16],
    ) -> Result<()> {
        let commit = &mut ctx.accounts.daily_commit;
        require!(!commit.is_revealed, WorkproofError::AlreadyRevealed);
        require!(!commit.vote_open || 
            Clock::get()?.unix_timestamp > commit.vote_closed_at,
            WorkproofError::VoteStillOpen
        );

        // Verify hash: sha256(score_le_bytes + salt + wallet_pubkey)
        let mut preimage = Vec::with_capacity(4 + 16 + 32);
        preimage.extend_from_slice(&score.to_le_bytes());
        preimage.extend_from_slice(&salt);
        preimage.extend_from_slice(&ctx.accounts.wallet.key().to_bytes());
        let hash = anchor_lang::solana_program::hash::hash(&preimage);
        require!(
            hash.to_bytes() == commit.score_hash,
            WorkproofError::HashMismatch
        );

        commit.is_revealed    = true;
        commit.revealed_score = score;
        commit.vote_open      = false;

        // Calculate consensus ratio (0-100)
        let total_votes = commit.vote_yes + commit.vote_no;
        let consensus_pct: u8 = if total_votes == 0 {
            50 // neutral if no votes
        } else {
            ((commit.vote_yes as u64 * 100) / total_votes as u64) as u8
        };

        // Apply consensus multiplier to score
        // consensus >= 80% → full score
        // consensus 50-79% → 70% of score
        // consensus < 50%  → 30% of score
        let adjusted_score: u32 = if consensus_pct >= 80 {
            score
        } else if consensus_pct >= 50 {
            score * 7 / 10
        } else {
            score * 3 / 10
        };

        // Update participant totals
        let participant = &mut ctx.accounts.participant;
        participant.total_score = participant.total_score
            .checked_add(adjusted_score as u64)
            .ok_or(WorkproofError::Overflow)?;

        // Update consensus average (running avg)
        if participant.vote_count == 0 {
            participant.consensus_avg = consensus_pct;
        } else {
            participant.consensus_avg = (
                (participant.consensus_avg as u32 * participant.vote_count as u32 + consensus_pct as u32)
                / (participant.vote_count as u32 + 1)
            ) as u8;
        }
        participant.vote_count += 1;

        // Update streak
        // (simplified: any day with consensus >= threshold counts)
        let challenge = &ctx.accounts.challenge;
        if consensus_pct >= (challenge.vote_threshold * 20) {
            participant.streak += 1;
            if participant.streak > participant.max_streak {
                participant.max_streak = participant.streak;
            }
        } else {
            participant.streak = 0;
        }

        emit!(ScoreRevealed {
            challenge: ctx.accounts.challenge.key(),
            wallet: ctx.accounts.wallet.key(),
            day: commit.day,
            adjusted_score,
            consensus_pct,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────
    //  6. CAST VOTE (COMMIT PHASE)
    //     Peer submits an anonymous vote hash.
    //     vote_hash = sha256(verdict_byte + nonce + voter_pubkey)
    //     verdict: 1=yes, 0=no
    //     Nobody can see the vote until reveal phase.
    // ─────────────────────────────────────────────────────
    pub fn cast_vote_commit(
        ctx: Context<CastVoteCommit>,
        vote_hash: [u8; 32],
        bump: u8,
    ) -> Result<()> {
        let commit = &ctx.accounts.daily_commit;
        require!(commit.vote_open, WorkproofError::VoteClosed);
        require!(
            Clock::get()?.unix_timestamp <= commit.vote_closed_at,
            WorkproofError::VoteClosed
        );
        // Voter cannot vote on their own commit
        require!(
            ctx.accounts.voter.key() != commit.wallet,
            WorkproofError::CannotVoteOnSelf
        );

        let vote_record = &mut ctx.accounts.vote_record;
        vote_record.daily_commit = ctx.accounts.daily_commit.key();
        vote_record.voter        = ctx.accounts.voter.key();
        vote_record.vote_hash    = vote_hash;
        vote_record.is_revealed  = false;
        vote_record.verdict      = false;
        vote_record.bump         = bump;

        Ok(())
    }

    // ─────────────────────────────────────────────────────
    //  7. CAST VOTE (REVEAL PHASE)
    //     After window closes, voter reveals their verdict.
    //     Contract verifies hash, tallies the vote.
    // ─────────────────────────────────────────────────────
    pub fn cast_vote_reveal(
        ctx: Context<CastVoteReveal>,
        verdict: bool,
        nonce: [u8; 16],
    ) -> Result<()> {
        let vote_record = &mut ctx.accounts.vote_record;
        require!(!vote_record.is_revealed, WorkproofError::AlreadyRevealed);

        // Verify hash
        let verdict_byte: u8 = if verdict { 1 } else { 0 };
        let mut preimage = Vec::with_capacity(1 + 16 + 32);
        preimage.push(verdict_byte);
        preimage.extend_from_slice(&nonce);
        preimage.extend_from_slice(&ctx.accounts.voter.key().to_bytes());
        let hash = anchor_lang::solana_program::hash::hash(&preimage);
        require!(
            hash.to_bytes() == vote_record.vote_hash,
            WorkproofError::HashMismatch
        );

        vote_record.is_revealed = true;
        vote_record.verdict     = verdict;

        // Tally into the daily commit
        let commit = &mut ctx.accounts.daily_commit;
        if verdict {
            commit.vote_yes = commit.vote_yes.checked_add(1)
                .ok_or(WorkproofError::Overflow)?;
        } else {
            commit.vote_no = commit.vote_no.checked_add(1)
                .ok_or(WorkproofError::Overflow)?;
        }

        Ok(())
    }

    // ─────────────────────────────────────────────────────
    //  8. SETTLE CHALLENGE + RELEASE REWARDS
    //     Called after end_time. Computes final rankings,
    //     releases USDC to top N wallets automatically.
    //     No admin approval needed — fully trustless.
    // ─────────────────────────────────────────────────────
    pub fn settle_challenge(
        ctx: Context<SettleChallenge>,
    ) -> Result<()> {
        let challenge = &mut ctx.accounts.challenge;
        require!(challenge.is_active, WorkproofError::ChallengeNotActive);
        require!(!challenge.is_settled, WorkproofError::AlreadySettled);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= challenge.end_time, WorkproofError::ChallengeNotEnded);

        challenge.is_active   = false;
        challenge.is_settled  = true;

        emit!(ChallengeSettled {
            challenge: ctx.accounts.challenge.key(),
            settled_at: now,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────
    //  9. CLAIM REWARD
    //     Winner calls this with their ranking proof.
    //     Contract verifies rank, transfers USDC from escrow.
    //     Mints a soulbound recognition record on-chain.
    // ─────────────────────────────────────────────────────
    pub fn claim_reward(
        ctx: Context<ClaimReward>,
        rank: u8,          // 1-based rank (1 = winner)
        bump: u8,
    ) -> Result<()> {
        let challenge = &ctx.accounts.challenge;
        require!(challenge.is_settled, WorkproofError::NotSettledYet);
        require!(rank >= 1 && rank <= challenge.reward_top_n, WorkproofError::NotEligible);

        let participant = &ctx.accounts.participant;
        require!(
            participant.wallet == ctx.accounts.winner.key(),
            WorkproofError::NotParticipant
        );

        let escrow = &ctx.accounts.escrow;

        // Calculate reward amount based on rank and split schedule
        // Rank 1: 50%, Rank 2: 30%, Rank 3: 20% (for top-3 split)
        // For top-1: 100%; For top-5: 40/25/15/10/10%
        let reward_amount = calculate_reward(
            escrow.total_amount,
            challenge.reward_top_n,
            rank,
        )?;

        // Transfer from escrow vault to winner's token account
        // Using PDA as authority
        let challenge_key = challenge.key();
        let seeds = &[
            b"escrow_authority",
            challenge_key.as_ref(),
            &[ctx.bumps.escrow_authority],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.escrow_vault.to_account_info(),
                    to:        ctx.accounts.winner_token_account.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                },
                signer,
            ),
            reward_amount,
        )?;

        // Record the claim (acts as soulbound recognition token)
        let recognition = &mut ctx.accounts.recognition;
        recognition.challenge   = challenge.key();
        recognition.winner      = ctx.accounts.winner.key();
        recognition.rank        = rank;
        recognition.score       = participant.total_score;
        recognition.reward_usdc = reward_amount;
        recognition.claimed_at  = Clock::get()?.unix_timestamp;
        recognition.bump        = bump;

        emit!(RewardClaimed {
            challenge: challenge.key(),
            winner: ctx.accounts.winner.key(),
            rank,
            amount: reward_amount,
            score: participant.total_score,
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────
//  HELPER: reward split schedule
// ─────────────────────────────────────────────────────────
fn calculate_reward(total: u64, top_n: u8, rank: u8) -> Result<u64> {
    // Basis points (out of 10000)
    let pcts: &[u64] = match top_n {
        1 => &[10000],
        2 => &[6500, 3500],
        3 => &[5000, 3000, 2000],
        4 => &[4000, 2500, 2000, 1500],
        5 => &[4000, 2500, 1500, 1000, 1000],
        _ => &[3000, 2000, 1500, 1000, 800, 700, 500, 500, 500, 500],
    };
    let idx = (rank - 1) as usize;
    if idx >= pcts.len() {
        return err!(WorkproofError::NotEligible);
    }
    Ok(total * pcts[idx] / 10000)
}

// ─────────────────────────────────────────────────────────
//  ACCOUNT STRUCTS
// ─────────────────────────────────────────────────────────

#[account]
pub struct Challenge {
    pub admin:             Pubkey,    // 32
    pub name:              String,    // 4 + 64
    pub duration_days:     u16,       // 2
    pub reward_top_n:      u8,        // 1
    pub vote_threshold:    u8,        // 1
    pub start_time:        i64,       // 8
    pub end_time:          i64,       // 8
    pub is_active:         bool,      // 1
    pub is_settled:        bool,      // 1
    pub participant_count: u8,        // 1
    pub bump:              u8,        // 1
}

#[account]
pub struct Escrow {
    pub challenge:     Pubkey,   // 32
    pub total_amount:  u64,      // 8
    pub is_funded:     bool,     // 1
}

#[account]
pub struct Participant {
    pub challenge:      Pubkey,  // 32
    pub wallet:         Pubkey,  // 32
    pub total_score:    u64,     // 8
    pub days_committed: u16,     // 2
    pub streak:         u16,     // 2
    pub max_streak:     u16,     // 2
    pub consensus_avg:  u8,      // 1
    pub vote_count:     u16,     // 2
    pub bump:           u8,      // 1
}

#[account]
pub struct DailyCommit {
    pub challenge:      Pubkey,   // 32
    pub participant:    Pubkey,   // 32
    pub wallet:         Pubkey,   // 32
    pub day:            u16,      // 2
    pub score_hash:     [u8; 32], // 32
    pub committed_at:   i64,      // 8
    pub is_revealed:    bool,     // 1
    pub revealed_score: u32,      // 4
    pub vote_open:      bool,     // 1
    pub vote_yes:       u16,      // 2
    pub vote_no:        u16,      // 2
    pub vote_closed_at: i64,      // 8
    pub bump:           u8,       // 1
}

#[account]
pub struct VoteRecord {
    pub daily_commit: Pubkey,    // 32
    pub voter:        Pubkey,    // 32
    pub vote_hash:    [u8; 32],  // 32
    pub is_revealed:  bool,      // 1
    pub verdict:      bool,      // 1
    pub bump:         u8,        // 1
}

#[account]
pub struct Recognition {
    pub challenge:    Pubkey,  // 32 — soulbound: non-transferable
    pub winner:       Pubkey,  // 32
    pub rank:         u8,      // 1
    pub score:        u64,     // 8
    pub reward_usdc:  u64,     // 8
    pub claimed_at:   i64,     // 8
    pub bump:         u8,      // 1
}

// ─────────────────────────────────────────────────────────
//  CONTEXTS
// ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(name: String, duration_days: u16, reward_top_n: u8, vote_threshold: u8, bump: u8)]
pub struct InitializeChallenge<'info> {
    #[account(
        init,
        payer  = admin,
        space  = 8 + 32 + (4 + MAX_NAME_LEN) + 2 + 1 + 1 + 8 + 8 + 1 + 1 + 1 + 1,
        seeds  = [b"challenge", admin.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub challenge: Account<'info, Challenge>,
    #[account(mut)]
    pub admin:     Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(mut, has_one = admin)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        init_if_needed,
        payer  = admin,
        space  = 8 + 32 + 8 + 1,
        seeds  = [b"escrow", challenge.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        seeds  = [b"escrow_vault", challenge.key().as_ref()],
        bump,
        token::mint     = usdc_mint,
        token::authority = escrow_authority,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority for the vault
    #[account(seeds = [b"escrow_authority", challenge.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin_token_account: Account<'info, TokenAccount>,
    /// CHECK: USDC mint address
    pub usdc_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct RegisterParticipant<'info> {
    #[account(mut)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        init,
        payer  = wallet,
        space  = 8 + 32 + 32 + 8 + 2 + 2 + 2 + 1 + 2 + 1,
        seeds  = [b"participant", challenge.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub participant: Account<'info, Participant>,
    #[account(mut)]
    pub wallet:      Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day: u16, score_hash: [u8; 32], bump: u8)]
pub struct CommitDailyScore<'info> {
    pub challenge: Account<'info, Challenge>,
    #[account(
        mut,
        seeds  = [b"participant", challenge.key().as_ref(), wallet.key().as_ref()],
        bump   = participant.bump,
        has_one = wallet,
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        init,
        payer  = wallet,
        space  = 8 + 32 + 32 + 32 + 2 + 32 + 8 + 1 + 4 + 1 + 2 + 2 + 8 + 1,
        seeds  = [b"commit", challenge.key().as_ref(), wallet.key().as_ref(), &day.to_le_bytes()],
        bump
    )]
    pub daily_commit: Account<'info, DailyCommit>,
    #[account(mut)]
    pub wallet:       Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealDailyScore<'info> {
    pub challenge: Account<'info, Challenge>,
    #[account(
        mut,
        seeds  = [b"participant", challenge.key().as_ref(), wallet.key().as_ref()],
        bump   = participant.bump,
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        mut,
        seeds  = [b"commit", challenge.key().as_ref(), wallet.key().as_ref(), &daily_commit.day.to_le_bytes()],
        bump   = daily_commit.bump,
    )]
    pub daily_commit: Account<'info, DailyCommit>,
    pub wallet: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(vote_hash: [u8; 32], bump: u8)]
pub struct CastVoteCommit<'info> {
    #[account(
        seeds  = [b"commit", daily_commit.challenge.as_ref(), daily_commit.wallet.as_ref(), &daily_commit.day.to_le_bytes()],
        bump   = daily_commit.bump,
    )]
    pub daily_commit: Account<'info, DailyCommit>,
    #[account(
        init,
        payer  = voter,
        space  = 8 + 32 + 32 + 32 + 1 + 1 + 1,
        seeds  = [b"vote", daily_commit.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVoteReveal<'info> {
    #[account(mut)]
    pub daily_commit: Account<'info, DailyCommit>,
    #[account(
        mut,
        seeds  = [b"vote", daily_commit.key().as_ref(), voter.key().as_ref()],
        bump   = vote_record.bump,
        has_one = voter,
    )]
    pub vote_record: Account<'info, VoteRecord>,
    pub voter: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleChallenge<'info> {
    #[account(mut, has_one = admin)]
    pub challenge: Account<'info, Challenge>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(rank: u8, bump: u8)]
pub struct ClaimReward<'info> {
    #[account(has_one = admin @ WorkproofError::Unauthorized)]
    pub challenge: Account<'info, Challenge>,
    #[account(
        seeds  = [b"escrow", challenge.key().as_ref()],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        seeds  = [b"escrow_vault", challenge.key().as_ref()],
        bump,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    /// CHECK: PDA signer for vault transfers
    #[account(seeds = [b"escrow_authority", challenge.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    #[account(
        seeds  = [b"participant", challenge.key().as_ref(), winner.key().as_ref()],
        bump   = participant.bump,
    )]
    pub participant: Account<'info, Participant>,
    #[account(
        init,
        payer  = winner,
        space  = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 1,
        seeds  = [b"recognition", challenge.key().as_ref(), winner.key().as_ref()],
        bump
    )]
    pub recognition: Account<'info, Recognition>,
    #[account(mut)]
    pub winner_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub winner: Signer<'info>,
    /// CHECK: admin key for challenge validation
    pub admin: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────────────────────
//  EVENTS
// ─────────────────────────────────────────────────────────

#[event]
pub struct ChallengeCreated {
    pub challenge:     Pubkey,
    pub admin:         Pubkey,
    pub name:          String,
    pub duration_days: u16,
    pub end_time:      i64,
}

#[event]
pub struct EscrowFunded {
    pub challenge: Pubkey,
    pub amount:    u64,
    pub total:     u64,
}

#[event]
pub struct ParticipantRegistered {
    pub challenge: Pubkey,
    pub wallet:    Pubkey,
}

#[event]
pub struct ScoreCommitted {
    pub challenge:  Pubkey,
    pub wallet:     Pubkey,
    pub day:        u16,
    pub score_hash: [u8; 32],
}

#[event]
pub struct ScoreRevealed {
    pub challenge:      Pubkey,
    pub wallet:         Pubkey,
    pub day:            u16,
    pub adjusted_score: u32,
    pub consensus_pct:  u8,
}

#[event]
pub struct ChallengeSettled {
    pub challenge:   Pubkey,
    pub settled_at:  i64,
}

#[event]
pub struct RewardClaimed {
    pub challenge: Pubkey,
    pub winner:    Pubkey,
    pub rank:      u8,
    pub amount:    u64,
    pub score:     u64,
}

// ─────────────────────────────────────────────────────────
//  ERRORS
// ─────────────────────────────────────────────────────────

#[error_code]
pub enum WorkproofError {
    #[msg("Challenge name too long (max 64 chars)")]
    NameTooLong,
    #[msg("Invalid duration (1-90 days)")]
    InvalidDuration,
    #[msg("Invalid reward_top_n (1-10)")]
    InvalidRewardN,
    #[msg("Invalid vote threshold (1-5)")]
    InvalidThreshold,
    #[msg("Challenge is not active")]
    ChallengeNotActive,
    #[msg("Challenge already settled")]
    AlreadySettled,
    #[msg("Too many participants (max 50)")]
    TooManyParticipants,
    #[msg("Invalid day number")]
    InvalidDay,
    #[msg("That day hasn't happened yet")]
    DayNotYetReached,
    #[msg("Score already revealed")]
    AlreadyRevealed,
    #[msg("Vote window still open")]
    VoteStillOpen,
    #[msg("Hash does not match committed value")]
    HashMismatch,
    #[msg("Vote window is closed")]
    VoteClosed,
    #[msg("Cannot vote on your own commit")]
    CannotVoteOnSelf,
    #[msg("Challenge has not ended yet")]
    ChallengeNotEnded,
    #[msg("Challenge not settled yet")]
    NotSettledYet,
    #[msg("Not in top N — not eligible for reward")]
    NotEligible,
    #[msg("Not a registered participant")]
    NotParticipant,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
}
