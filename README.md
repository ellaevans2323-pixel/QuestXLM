# QuestXLM

A gamified learn-to-earn protocol on Soroban where students earn XLM micro-rewards for completing verified quiz modules.

## Architecture

```
┌─────────────┐   POST /approve-answer   ┌──────────────────┐
│  React App  │ ─────────────────────── ▶│  Oracle (Node.js)│
│  (Frontend) │                          │  Verifies answers │
└──────┬──────┘                          │  Calls contract   │
       │ submit_completion (RPC)         └────────┬─────────┘
       ▼                                          │ approve_answer (RPC)
┌─────────────────────────────────────────────────▼──────────┐
│                  Soroban Contract                           │
│  add_module · fund_treasury · approve_answer               │
│  submit_completion · learner_stats                         │
└────────────────────────────────────────────────────────────┘
       ▲
       │ fund_treasury (daily cron)
┌──────┴──────────────────────┐
│  GitHub Actions Cron (.yml) │
│  scripts/fund-treasury.js   │
└─────────────────────────────┘
```

## Anti-Cheat Design

Answer hashes are computed as `sha256(answerText + learnerAddress + moduleId)`. Because the learner's address is baked into the hash, a hash approved for Alice cannot be replayed by Bob. The oracle burns the hash on first use (contract removes it after redemption).

## Project Structure

```
contract/         Soroban Rust contract
  src/lib.rs      Contract implementation
  src/test.rs     Unit tests
  Cargo.toml

frontend/         React quiz UI
  src/App.jsx     Quiz modules, countdown timer, submission
  src/soroban.js  Stellar SDK RPC helpers
  src/index.js

oracle/           Node.js oracle service
  index.js        POST /approve-answer, GET /leaderboard

scripts/          CI utility scripts
  fund-treasury.js

.github/workflows/
  treasury-topup.yml   Daily cron top-up
```

## Setup

### 1. Deploy the Contract

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/quest_xlm.wasm --network testnet
# Then initialize:
stellar contract invoke --id <CONTRACT_ID> -- initialize --admin <ADMIN_ADDRESS> --quiz_oracle <ORACLE_ADDRESS>
```

### 2. Start the Oracle

```bash
cd oracle
npm install
ORACLE_SECRET=S... CONTRACT_ID=C... node index.js
```

### 3. Start the Frontend

```bash
cd frontend
npm install
REACT_APP_CONTRACT_ID=C... REACT_APP_ORACLE_URL=http://localhost:3001 npm start
```

### 4. GitHub Actions Secrets

Set in repo Settings → Secrets:
- `ADMIN_SECRET` — Stellar secret key for the admin account
- `CONTRACT_ID` — Deployed contract address

Set in Variables:
- `TOPUP_AMOUNT` — Amount in stroops (default: 10000000 = 1 XLM)
- `RPC_URL` — Soroban RPC endpoint

## API Reference

### Oracle

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/approve-answer` | `{moduleId, answerText, learnerAddress}` | `{ok: true}` |
| GET | `/leaderboard` | — | `[{address, totalEarned}]` (top 10) |

### Contract

| Function | Caller | Description |
|----------|--------|-------------|
| `initialize` | deployer | Set admin + oracle |
| `add_module` | admin | Register quiz module |
| `fund_treasury` | admin | Deposit XLM |
| `approve_answer` | oracle | Pre-approve answer hash |
| `submit_completion` | learner | Claim reward |
| `learner_stats` | anyone | View completion history |

## Running Tests

```bash
cd contract
cargo test
```
