use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("J8ff2KX2Csxmr2FveXN1z42tDxq99ojZKMs3qdKJVBXg");

const MAX_PARTICIPANTS: usize = 50;
const MAX_NAME_LEN: usize = 64;
const MAX_DAYS: u16 = 90;
const VOTE_WINDOW_SECONDS: i64 = 6 * 60 * 60;

#[program]
pub mod workproof {
    use super::*;

    pub fn initialize_challenge(
        ctx: Context<InitializeChallenge>,
        name: String,
        duration_days: u16,
        reward_top_n: u8,
        vote_threshold: u8,
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, WorkproofError::NameTooLong);
        require!(duration_days > 0 && duration_days <= MAX_DAYS, WorkproofError::InvalidDuration);
        require!(reward_top_n >= 1 && reward_top_n <= 10, WorkproofError::InvalidRewardN);
        require!(vote_threshold >= 1 && vote_threshold <= 5, WorkproofError::InvalidThreshold);

        let now = Clock::get()?.unix_timestamp;
        let admin_key = ctx.accounts.admin.key();
        let challenge_key = ctx.accounts.challenge.key();

        let challenge = &mut ctx.accounts.challenge;
        challenge.admin             = admin_key;
        challenge.name              = name.clone();
        challenge.duration_days     = duration_days;
        challenge.reward_top_n      = reward_top_n;
        challenge.vote_threshold    = vote_threshold;
        challenge.start_time        = now;
        challenge.end_time          = now + (duration_days as i64 * 86400);
        challenge.is_active         = true;
        challenge.is_settled        = false;
        challenge.participant_count = 0;
        challenge.bump              = ctx.bumps.challenge;

        emit!(ChallengeCreated { challenge: challenge_key, admin: admin_key, name, duration_days, end_time: challenge.end_time });
        Ok(())
    }

    pub fn fund_escrow(ctx: Context<FundEscrow>, amount: u64) -> Result<()> {
        require!(ctx.accounts.challenge.is_active, WorkproofError::ChallengeNotActive);
        require!(!ctx.accounts.challenge.is_settled, WorkproofError::AlreadySettled);

        let challenge_key = ctx.accounts.challenge.key();

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.admin_token_account.to_account_info(),
                    to: ctx.accounts.escrow_vault.to_account_info(),
                    authority: ctx.accounts.admin.to_account_info(),
                },
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.challenge    = challenge_key;
        escrow.total_amount = escrow.total_amount.checked_add(amount).ok_or(WorkproofError::Overflow)?;
        escrow.is_funded    = true;

        emit!(EscrowFunded { challenge: challenge_key, amount, total: escrow.total_amount });
        Ok(())
    }

    pub fn register_participant(ctx: Context<RegisterParticipant>) -> Result<()> {
        require!(ctx.accounts.challenge.is_active, WorkproofError::ChallengeNotActive);
        require!(ctx.accounts.challenge.participant_count < MAX_PARTICIPANTS as u8, WorkproofError::TooManyParticipants);

        let challenge_key = ctx.accounts.challenge.key();
        let wallet_key    = ctx.accounts.wallet.key();

        let participant = &mut ctx.accounts.participant;
        participant.challenge      = challenge_key;
        participant.wallet         = wallet_key;
        participant.total_score    = 0;
        participant.days_committed = 0;
        participant.streak         = 0;
        participant.max_streak     = 0;
        participant.consensus_avg  = 0;
        participant.vote_count     = 0;
        participant.bump           = ctx.bumps.participant;

        ctx.accounts.challenge.participant_count += 1;

        emit!(ParticipantRegistered { challenge: challenge_key, wallet: wallet_key });
        Ok(())
    }

    pub fn commit_daily_score(ctx: Context<CommitDailyScore>, day: u16, score_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        {
            let challenge = &ctx.accounts.challenge;
            require!(challenge.is_active, WorkproofError::ChallengeNotActive);
            require!(day < challenge.duration_days, WorkproofError::InvalidDay);
            let elapsed = ((now - challenge.start_time) / 86400) as u16;
            require!(day <= elapsed, WorkproofError::DayNotYetReached);
        }

        let challenge_key   = ctx.accounts.challenge.key();
        let wallet_key      = ctx.accounts.wallet.key();
        let participant_key = ctx.accounts.participant.key();

        let commit = &mut ctx.accounts.daily_commit;
        commit.challenge      = challenge_key;
        commit.participant    = participant_key;
        commit.wallet         = wallet_key;
        commit.day            = day;
        commit.score_hash     = score_hash;
        commit.committed_at   = now;
        commit.is_revealed    = false;
        commit.revealed_score = 0;
        commit.vote_open      = true;
        commit.vote_yes       = 0;
        commit.vote_no        = 0;
        commit.vote_closed_at = now + VOTE_WINDOW_SECONDS;
        commit.bump           = ctx.bumps.daily_commit;

        ctx.accounts.participant.days_committed += 1;

        emit!(ScoreCommitted { challenge: challenge_key, wallet: wallet_key, day, score_hash });
        Ok(())
    }

    pub fn reveal_daily_score(ctx: Context<RevealDailyScore>, score: u32, salt: [u8; 16]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        {
            let commit = &ctx.accounts.daily_commit;
            require!(!commit.is_revealed, WorkproofError::AlreadyRevealed);
            require!(!commit.vote_open || now > commit.vote_closed_at, WorkproofError::VoteStillOpen);

            let mut preimage = Vec::with_capacity(52);
            preimage.extend_from_slice(&score.to_le_bytes());
            preimage.extend_from_slice(&salt);
            preimage.extend_from_slice(&ctx.accounts.wallet.key().to_bytes());
            let hash = anchor_lang::solana_program::hash::hash(&preimage);
            require!(hash.to_bytes() == commit.score_hash, WorkproofError::HashMismatch);
        }

        let (vote_yes, vote_no) = (ctx.accounts.daily_commit.vote_yes, ctx.accounts.daily_commit.vote_no);
        let total_votes = vote_yes + vote_no;
        let consensus_pct: u8 = if total_votes == 0 { 50 } else { ((vote_yes as u64 * 100) / total_votes as u64) as u8 };

        let adjusted_score: u32 = if consensus_pct >= 80 { score } else if consensus_pct >= 50 { score * 7 / 10 } else { score * 3 / 10 };

        {
            let commit = &mut ctx.accounts.daily_commit;
            commit.is_revealed    = true;
            commit.revealed_score = score;
            commit.vote_open      = false;
        }

        let threshold     = ctx.accounts.challenge.vote_threshold;
        let challenge_key = ctx.accounts.challenge.key();
        let wallet_key    = ctx.accounts.wallet.key();
        let day           = ctx.accounts.daily_commit.day;

        let p = &mut ctx.accounts.participant;
        p.total_score = p.total_score.checked_add(adjusted_score as u64).ok_or(WorkproofError::Overflow)?;
        p.consensus_avg = if p.vote_count == 0 { consensus_pct } else { ((p.consensus_avg as u32 * p.vote_count as u32 + consensus_pct as u32) / (p.vote_count as u32 + 1)) as u8 };
        p.vote_count += 1;
        if consensus_pct >= threshold * 20 { p.streak += 1; if p.streak > p.max_streak { p.max_streak = p.streak; } } else { p.streak = 0; }

        emit!(ScoreRevealed { challenge: challenge_key, wallet: wallet_key, day, adjusted_score, consensus_pct });
        Ok(())
    }

    pub fn cast_vote_commit(ctx: Context<CastVoteCommit>, vote_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.daily_commit.vote_open, WorkproofError::VoteClosed);
        require!(now <= ctx.accounts.daily_commit.vote_closed_at, WorkproofError::VoteClosed);
        require!(ctx.accounts.voter.key() != ctx.accounts.daily_commit.wallet, WorkproofError::CannotVoteOnSelf);

        let commit_key = ctx.accounts.daily_commit.key();
        let voter_key  = ctx.accounts.voter.key();

        let vr = &mut ctx.accounts.vote_record;
        vr.daily_commit = commit_key;
        vr.voter        = voter_key;
        vr.vote_hash    = vote_hash;
        vr.is_revealed  = false;
        vr.verdict      = false;
        vr.bump         = ctx.bumps.vote_record;
        Ok(())
    }

    pub fn cast_vote_reveal(ctx: Context<CastVoteReveal>, verdict: bool, nonce: [u8; 16]) -> Result<()> {
        require!(!ctx.accounts.vote_record.is_revealed, WorkproofError::AlreadyRevealed);

        let mut preimage = Vec::with_capacity(49);
        preimage.push(if verdict { 1u8 } else { 0u8 });
        preimage.extend_from_slice(&nonce);
        preimage.extend_from_slice(&ctx.accounts.voter.key().to_bytes());
        let hash = anchor_lang::solana_program::hash::hash(&preimage);
        require!(hash.to_bytes() == ctx.accounts.vote_record.vote_hash, WorkproofError::HashMismatch);

        ctx.accounts.vote_record.is_revealed = true;
        ctx.accounts.vote_record.verdict     = verdict;

        if verdict {
            ctx.accounts.daily_commit.vote_yes = ctx.accounts.daily_commit.vote_yes.checked_add(1).ok_or(WorkproofError::Overflow)?;
        } else {
            ctx.accounts.daily_commit.vote_no = ctx.accounts.daily_commit.vote_no.checked_add(1).ok_or(WorkproofError::Overflow)?;
        }
        Ok(())
    }

    pub fn settle_challenge(ctx: Context<SettleChallenge>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.challenge.is_active, WorkproofError::ChallengeNotActive);
        require!(!ctx.accounts.challenge.is_settled, WorkproofError::AlreadySettled);
        require!(now >= ctx.accounts.challenge.end_time, WorkproofError::ChallengeNotEnded);

        let challenge_key = ctx.accounts.challenge.key();
        ctx.accounts.challenge.is_active  = false;
        ctx.accounts.challenge.is_settled = true;

        emit!(ChallengeSettled { challenge: challenge_key, settled_at: now });
        Ok(())
    }

    pub fn claim_reward(ctx: Context<ClaimReward>, rank: u8) -> Result<()> {
        require!(ctx.accounts.challenge.is_settled, WorkproofError::NotSettledYet);
        require!(rank >= 1 && rank <= ctx.accounts.challenge.reward_top_n, WorkproofError::NotEligible);
        require!(ctx.accounts.participant.wallet == ctx.accounts.winner.key(), WorkproofError::NotParticipant);

        let challenge_key = ctx.accounts.challenge.key();
        let winner_key    = ctx.accounts.winner.key();
        let total_score   = ctx.accounts.participant.total_score;
        let reward_amount = calculate_reward(ctx.accounts.escrow.total_amount, ctx.accounts.challenge.reward_top_n, rank)?;

        let seeds = &[b"escrow_authority".as_ref(), challenge_key.as_ref(), &[ctx.bumps.escrow_authority]];
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

        let r = &mut ctx.accounts.recognition;
        r.challenge   = challenge_key;
        r.winner      = winner_key;
        r.rank        = rank;
        r.score       = total_score;
        r.reward_usdc = reward_amount;
        r.claimed_at  = Clock::get()?.unix_timestamp;
        r.bump        = ctx.bumps.recognition;

        emit!(RewardClaimed { challenge: challenge_key, winner: winner_key, rank, amount: reward_amount, score: total_score });
        Ok(())
    }
}

fn calculate_reward(total: u64, top_n: u8, rank: u8) -> Result<u64> {
    let pcts: &[u64] = match top_n {
        1 => &[10000],
        2 => &[6500, 3500],
        3 => &[5000, 3000, 2000],
        4 => &[4000, 2500, 2000, 1500],
        5 => &[4000, 2500, 1500, 1000, 1000],
        _ => &[3000, 2000, 1500, 1000, 800, 700, 500, 500, 500, 500],
    };
    let idx = (rank - 1) as usize;
    if idx >= pcts.len() { return err!(WorkproofError::NotEligible); }
    Ok(total * pcts[idx] / 10000)
}

#[account] pub struct Challenge { pub admin: Pubkey, pub name: String, pub duration_days: u16, pub reward_top_n: u8, pub vote_threshold: u8, pub start_time: i64, pub end_time: i64, pub is_active: bool, pub is_settled: bool, pub participant_count: u8, pub bump: u8 }
#[account] pub struct Escrow { pub challenge: Pubkey, pub total_amount: u64, pub is_funded: bool }
#[account] pub struct Participant { pub challenge: Pubkey, pub wallet: Pubkey, pub total_score: u64, pub days_committed: u16, pub streak: u16, pub max_streak: u16, pub consensus_avg: u8, pub vote_count: u16, pub bump: u8 }
#[account] pub struct DailyCommit { pub challenge: Pubkey, pub participant: Pubkey, pub wallet: Pubkey, pub day: u16, pub score_hash: [u8; 32], pub committed_at: i64, pub is_revealed: bool, pub revealed_score: u32, pub vote_open: bool, pub vote_yes: u16, pub vote_no: u16, pub vote_closed_at: i64, pub bump: u8 }
#[account] pub struct VoteRecord { pub daily_commit: Pubkey, pub voter: Pubkey, pub vote_hash: [u8; 32], pub is_revealed: bool, pub verdict: bool, pub bump: u8 }
#[account] pub struct Recognition { pub challenge: Pubkey, pub winner: Pubkey, pub rank: u8, pub score: u64, pub reward_usdc: u64, pub claimed_at: i64, pub bump: u8 }

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeChallenge<'info> {
    #[account(init, payer = admin, space = 8 + 32 + (4 + MAX_NAME_LEN) + 2 + 1 + 1 + 8 + 8 + 1 + 1 + 1 + 1, seeds = [b"challenge", admin.key().as_ref(), name.as_bytes()], bump)]
    pub challenge: Account<'info, Challenge>,
    #[account(mut)] pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(mut)] pub challenge: Account<'info, Challenge>,
    #[account(init_if_needed, payer = admin, space = 8 + 32 + 8 + 1, seeds = [b"escrow", challenge.key().as_ref()], bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, seeds = [b"escrow_vault", challenge.key().as_ref()], bump, token::mint = usdc_mint, token::authority = escrow_authority)]
    pub escrow_vault: Account<'info, TokenAccount>,
    /// CHECK: PDA authority
    #[account(seeds = [b"escrow_authority", challenge.key().as_ref()], bump)] pub escrow_authority: UncheckedAccount<'info>,
    #[account(mut)] pub admin_token_account: Account<'info, TokenAccount>,
    /// CHECK: USDC mint
    pub usdc_mint: UncheckedAccount<'info>,
    #[account(mut)] pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RegisterParticipant<'info> {
    #[account(mut)] pub challenge: Account<'info, Challenge>,
    #[account(init, payer = wallet, space = 8 + 32 + 32 + 8 + 2 + 2 + 2 + 1 + 2 + 1, seeds = [b"participant", challenge.key().as_ref(), wallet.key().as_ref()], bump)]
    pub participant: Account<'info, Participant>,
    #[account(mut)] pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day: u16, score_hash: [u8; 32])]
pub struct CommitDailyScore<'info> {
    pub challenge: Account<'info, Challenge>,
    #[account(mut, seeds = [b"participant", challenge.key().as_ref(), wallet.key().as_ref()], bump = participant.bump, has_one = wallet)]
    pub participant: Account<'info, Participant>,
    #[account(init, payer = wallet, space = 8 + 32 + 32 + 32 + 2 + 32 + 8 + 1 + 4 + 1 + 2 + 2 + 8 + 1, seeds = [b"commit", challenge.key().as_ref(), wallet.key().as_ref(), &day.to_le_bytes()], bump)]
    pub daily_commit: Account<'info, DailyCommit>,
    #[account(mut)] pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealDailyScore<'info> {
    pub challenge: Account<'info, Challenge>,
    #[account(mut, seeds = [b"participant", challenge.key().as_ref(), wallet.key().as_ref()], bump = participant.bump, has_one = wallet)]
    pub participant: Account<'info, Participant>,
    #[account(mut, seeds = [b"commit", challenge.key().as_ref(), wallet.key().as_ref(), &daily_commit.day.to_le_bytes()], bump = daily_commit.bump, has_one = wallet)]
    pub daily_commit: Account<'info, DailyCommit>,
    pub wallet: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(vote_hash: [u8; 32])]
pub struct CastVoteCommit<'info> {
    #[account(mut)] pub daily_commit: Account<'info, DailyCommit>,
    #[account(init, payer = voter, space = 8 + 32 + 32 + 32 + 1 + 1 + 1, seeds = [b"vote", daily_commit.key().as_ref(), voter.key().as_ref()], bump)]
    pub vote_record: Account<'info, VoteRecord>,
    #[account(mut)] pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVoteReveal<'info> {
    #[account(mut)] pub daily_commit: Account<'info, DailyCommit>,
    #[account(mut, seeds = [b"vote", daily_commit.key().as_ref(), voter.key().as_ref()], bump = vote_record.bump, has_one = voter)]
    pub vote_record: Account<'info, VoteRecord>,
    pub voter: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleChallenge<'info> {
    #[account(mut, has_one = admin)] pub challenge: Account<'info, Challenge>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(rank: u8)]
pub struct ClaimReward<'info> {
    pub challenge: Account<'info, Challenge>,
    #[account(seeds = [b"escrow", challenge.key().as_ref()], bump)] pub escrow: Account<'info, Escrow>,
    #[account(mut, seeds = [b"escrow_vault", challenge.key().as_ref()], bump)] pub escrow_vault: Account<'info, TokenAccount>,
    /// CHECK: PDA signer
    #[account(seeds = [b"escrow_authority", challenge.key().as_ref()], bump)] pub escrow_authority: UncheckedAccount<'info>,
    #[account(seeds = [b"participant", challenge.key().as_ref(), winner.key().as_ref()], bump = participant.bump, constraint = participant.wallet == winner.key() @ WorkproofError::NotParticipant)]
    pub participant: Account<'info, Participant>,
    #[account(init, payer = winner, space = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 1, seeds = [b"recognition", challenge.key().as_ref(), winner.key().as_ref()], bump)]
    pub recognition: Account<'info, Recognition>,
    #[account(mut)] pub winner_token_account: Account<'info, TokenAccount>,
    #[account(mut)] pub winner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event] pub struct ChallengeCreated     { pub challenge: Pubkey, pub admin: Pubkey, pub name: String, pub duration_days: u16, pub end_time: i64 }
#[event] pub struct EscrowFunded         { pub challenge: Pubkey, pub amount: u64, pub total: u64 }
#[event] pub struct ParticipantRegistered{ pub challenge: Pubkey, pub wallet: Pubkey }
#[event] pub struct ScoreCommitted       { pub challenge: Pubkey, pub wallet: Pubkey, pub day: u16, pub score_hash: [u8; 32] }
#[event] pub struct ScoreRevealed        { pub challenge: Pubkey, pub wallet: Pubkey, pub day: u16, pub adjusted_score: u32, pub consensus_pct: u8 }
#[event] pub struct ChallengeSettled     { pub challenge: Pubkey, pub settled_at: i64 }
#[event] pub struct RewardClaimed        { pub challenge: Pubkey, pub winner: Pubkey, pub rank: u8, pub amount: u64, pub score: u64 }

#[error_code]
pub enum WorkproofError {
    #[msg("Challenge name too long")]          NameTooLong,
    #[msg("Invalid duration (1-90 days)")]     InvalidDuration,
    #[msg("Invalid reward_top_n (1-10)")]      InvalidRewardN,
    #[msg("Invalid vote threshold (1-5)")]     InvalidThreshold,
    #[msg("Challenge is not active")]          ChallengeNotActive,
    #[msg("Challenge already settled")]        AlreadySettled,
    #[msg("Too many participants (max 50)")]   TooManyParticipants,
    #[msg("Invalid day number")]               InvalidDay,
    #[msg("That day hasn't happened yet")]     DayNotYetReached,
    #[msg("Score already revealed")]           AlreadyRevealed,
    #[msg("Vote window still open")]           VoteStillOpen,
    #[msg("Hash mismatch")]                    HashMismatch,
    #[msg("Vote window is closed")]            VoteClosed,
    #[msg("Cannot vote on your own commit")]   CannotVoteOnSelf,
    #[msg("Challenge has not ended yet")]      ChallengeNotEnded,
    #[msg("Challenge not settled yet")]        NotSettledYet,
    #[msg("Not eligible for reward")]          NotEligible,
    #[msg("Not a registered participant")]     NotParticipant,
    #[msg("Unauthorized")]                     Unauthorized,
    #[msg("Arithmetic overflow")]              Overflow,
}
