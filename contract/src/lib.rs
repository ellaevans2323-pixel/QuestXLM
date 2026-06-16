#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, BytesN, Env, Map, Vec,
};

// ── Storage Keys ────────────────────────────────────────────────────────────

#[contracttype] pub enum DataKey {
    Admin,
    Oracle,
    Treasury,
    ModuleCount,
    Module(u32),
    Progress(Address),
    ApprovedAnswer(u32, BytesN<32>),
}

// ── Types ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Module {
    pub quiz_hash:        BytesN<32>,
    pub reward_xlm:       i128,
    pub cooldown_seconds: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Progress {
    pub completions: Map<u32, u64>, // module_id -> last completion timestamp
}

// ── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized    = 1,
    CooldownActive  = 2,
    WrongAnswer     = 3,
    TreasuryEmpty   = 4,
    ModuleNotFound  = 5,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct QuestXLM;

#[contractimpl]
impl QuestXLM {
    // ── Init ────────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, quiz_oracle: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin,   &admin);
        env.storage().instance().set(&DataKey::Oracle,  &quiz_oracle);
        env.storage().instance().set(&DataKey::Treasury, &0_i128);
        env.storage().instance().set(&DataKey::ModuleCount, &0_u32);
    }

    // ── Admin: add a quiz module ────────────────────────────────────────────

    pub fn add_module(
        env:           Env,
        quiz_hash:     BytesN<32>,
        reward_xlm:    i128,
        cooldown_secs: u64,
    ) -> Result<u32, Error> {
        Self::require_admin(&env)?;
        let id: u32 = env.storage().instance().get(&DataKey::ModuleCount).unwrap_or(0);
        let module = Module { quiz_hash, reward_xlm, cooldown_seconds: cooldown_secs };
        env.storage().persistent().set(&DataKey::Module(id), &module);
        env.storage().instance().set(&DataKey::ModuleCount, &(id + 1));
        Ok(id)
    }

    // ── Admin: deposit XLM into treasury ───────────────────────────────────

    pub fn fund_treasury(env: Env, amount: i128) -> Result<(), Error> {
        Self::require_admin(&env)?;
        let bal: i128 = env.storage().instance().get(&DataKey::Treasury).unwrap_or(0);
        env.storage().instance().set(&DataKey::Treasury, &(bal + amount));
        Ok(())
    }

    // ── Oracle: pre-approve correct answer hash ─────────────────────────────
    // answer_hash = sha256(answer_text + learner_address + module_id)
    // computed off-chain by oracle to prevent sharing

    pub fn approve_answer(
        env:         Env,
        module_id:   u32,
        answer_hash: BytesN<32>,
    ) -> Result<(), Error> {
        Self::require_oracle(&env)?;
        env.storage().persistent().set(
            &DataKey::ApprovedAnswer(module_id, answer_hash),
            &true,
        );
        Ok(())
    }

    // ── Learner: submit quiz completion ────────────────────────────────────

    pub fn submit_completion(
        env:         Env,
        learner:     Address,
        module_id:   u32,
        answer_hash: BytesN<32>,
    ) -> Result<(), Error> {
        learner.require_auth();

        // verify oracle pre-approved this exact (module, learner-specific) hash
        let approved: bool = env.storage().persistent()
            .get(&DataKey::ApprovedAnswer(module_id, answer_hash.clone()))
            .unwrap_or(false);
        if !approved {
            return Err(Error::WrongAnswer);
        }

        let module: Module = env.storage().persistent()
            .get(&DataKey::Module(module_id))
            .ok_or(Error::ModuleNotFound)?;

        // cooldown check
        let now = env.ledger().timestamp();
        let mut progress: Progress = env.storage().persistent()
            .get(&DataKey::Progress(learner.clone()))
            .unwrap_or(Progress { completions: Map::new(&env) });

        if let Some(last) = progress.completions.get(module_id) {
            if now < last + module.cooldown_seconds {
                return Err(Error::CooldownActive);
            }
        }

        // treasury check
        let treasury: i128 = env.storage().instance().get(&DataKey::Treasury).unwrap_or(0);
        if treasury < module.reward_xlm {
            return Err(Error::TreasuryEmpty);
        }

        // update state
        progress.completions.set(module_id, now);
        env.storage().persistent().set(&DataKey::Progress(learner.clone()), &progress);
        env.storage().instance().set(&DataKey::Treasury, &(treasury - module.reward_xlm));

        // burn the approved answer so it can't be replayed
        env.storage().persistent().remove(&DataKey::ApprovedAnswer(module_id, answer_hash));

        // emit event for off-chain indexing
        env.events().publish(
            (soroban_sdk::symbol_short!("reward"), learner),
            module.reward_xlm,
        );

        Ok(())
    }

    // ── View: learner stats ─────────────────────────────────────────────────

    pub fn learner_stats(env: Env, learner: Address) -> Vec<(u32, u64)> {
        let progress: Progress = env.storage().persistent()
            .get(&DataKey::Progress(learner))
            .unwrap_or(Progress { completions: Map::new(&env) });
        let mut out = Vec::new(&env);
        for (k, v) in progress.completions.iter() {
            out.push_back((k, v));
        }
        out
    }

    // ── View: treasury balance ──────────────────────────────────────────────

    pub fn treasury_balance(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Treasury).unwrap_or(0)
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        Ok(())
    }

    fn require_oracle(env: &Env) -> Result<(), Error> {
        let oracle: Address = env.storage().instance().get(&DataKey::Oracle).unwrap();
        oracle.require_auth();
        Ok(())
    }
}
