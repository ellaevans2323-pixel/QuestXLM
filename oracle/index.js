import express from "express";
import crypto from "crypto";
import {
  Keypair,
  Networks,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

const app = express();
app.use(express.json());

// ── Config ───────────────────────────────────────────────────────────────────
const PORT           = process.env.PORT         || 3001;
const CONTRACT_ID    = process.env.CONTRACT_ID  || "";
const ORACLE_SECRET  = process.env.ORACLE_SECRET;           // Stellar secret key
const RPC_URL        = process.env.RPC_URL      || "https://soroban-testnet.stellar.org";
const NETWORK        = Networks.TESTNET;

if (!ORACLE_SECRET) { console.error("ORACLE_SECRET required"); process.exit(1); }

const oracleKeypair = Keypair.fromSecret(ORACLE_SECRET);
const server        = new SorobanRpc.Server(RPC_URL);
const contract      = new Contract(CONTRACT_ID);

// ── Correct answers (module_id -> answer text) ───────────────────────────────
// In production, load from a secure store / DB.
const CORRECT_ANSWERS = {
  0: ["SCP", "XLM"],          // module 0: answers for each question in order
  1: ["Rust", "ledger().timestamp()"],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Mirrors frontend buildAnswerHash: sha256(answerText + learnerAddress + moduleId) */
function buildAnswerHash(answerText, learnerAddress, moduleId) {
  return crypto.createHash("sha256")
    .update(`${answerText}${learnerAddress}${moduleId}`)
    .digest();
}

/** Call approve_answer on the contract as the oracle */
async function approveOnChain(moduleId, answerHashBuf) {
  const account = await server.getAccount(oracleKeypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: NETWORK })
    .addOperation(contract.call(
      "approve_answer",
      xdr.ScVal.scvU32(moduleId),
      xdr.ScVal.scvBytes(answerHashBuf),
    ))
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(oracleKeypair);
  return server.sendTransaction(prepared);
}

// ── POST /approve-answer ─────────────────────────────────────────────────────
// Body: { moduleId: number, answerText: "SCP|XLM", learnerAddress: "G…" }
// answerText is pipe-joined answers (matches frontend)
app.post("/approve-answer", async (req, res) => {
  const { moduleId, answerText, learnerAddress } = req.body;

  if (moduleId === undefined || !answerText || !learnerAddress) {
    return res.status(400).json({ error: "moduleId, answerText, learnerAddress required" });
  }

  const correct = CORRECT_ANSWERS[moduleId];
  if (!correct) return res.status(404).json({ error: "Module not found" });

  // Verify each answer (case-insensitive, trimmed)
  const submitted = answerText.split("|").map(a => a.trim().toLowerCase());
  const allCorrect = correct.every((a, i) =>
    submitted[i] === a.toLowerCase()
  );

  if (!allCorrect) return res.status(400).json({ error: "Incorrect answers" });

  try {
    const hashBuf = buildAnswerHash(answerText, learnerAddress, moduleId);
    await approveOnChain(moduleId, hashBuf);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /leaderboard — top 10 earners ───────────────────────────────────────
// Reads learner_stats via RPC for known addresses.
// For a production app, index events from the RPC event stream instead.
app.get("/leaderboard", async (req, res) => {
  try {
    // Fetch "reward" events emitted by the contract to discover learner addresses
    const { events } = await server.getEvents({
      startLedger: 1,
      filters: [{ type: "contract", contractIds: [CONTRACT_ID], topics: [["*"]] }],
      limit: 200,
    });

    // Tally rewards per learner from events
    const totals = {};
    for (const ev of events) {
      // event value = reward amount i128
      const learner = ev.topic[1]?.address?.toString();
      const amount  = ev.value?.i128?.lo ?? 0;
      if (learner) totals[learner] = (totals[learner] || 0) + Number(amount);
    }

    const leaderboard = Object.entries(totals)
      .map(([address, totalEarned]) => ({ address, totalEarned }))
      .sort((a, b) => b.totalEarned - a.totalEarned)
      .slice(0, 10);

    res.json(leaderboard);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Oracle running on :${PORT}`));
