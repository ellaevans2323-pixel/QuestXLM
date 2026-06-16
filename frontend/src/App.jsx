import { useState, useEffect, useCallback } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import { submitCompletion, buildAnswerHash } from "./soroban";

const ORACLE_URL = process.env.REACT_APP_ORACLE_URL || "http://localhost:3001";
const QUIZ_TIME  = 60; // seconds

const MODULES = [
  { id: 0, title: "Stellar Basics", reward: "0.1 XLM", questions: [
    { q: "What consensus protocol does Stellar use?", a: "SCP" },
    { q: "What is the native asset on Stellar?", a: "XLM" },
  ]},
  { id: 1, title: "Soroban Smart Contracts", reward: "0.2 XLM", questions: [
    { q: "What language are Soroban contracts written in?", a: "Rust" },
    { q: "What is the Soroban function to read ledger time?", a: "ledger().timestamp()" },
  ]},
];

function CountdownTimer({ seconds, onExpire }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) { onExpire(); return; }
    const t = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onExpire]);

  const pct = (remaining / seconds) * 100;
  const color = remaining < 10 ? "#e74c3c" : remaining < 20 ? "#f39c12" : "#2ecc71";

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 24, fontWeight: "bold", color }}>{remaining}s</div>
      <div style={{ background: "#eee", borderRadius: 4, height: 8 }}>
        <div style={{ width: `${pct}%`, background: color, height: 8, borderRadius: 4, transition: "width 1s linear" }} />
      </div>
    </div>
  );
}

function QuizModule({ module, keypair, onComplete }) {
  const [step, setStep]     = useState(0); // question index
  const [answers, setAnswers] = useState({});
  const [expired, setExpired] = useState(false);
  const [status, setStatus]   = useState("");

  const handleExpire = useCallback(() => {
    setExpired(true);
    setStatus("⏰ Time's up!");
  }, []);

  const submit = async () => {
    // concatenate all answers as the submission answer text
    const answerText = module.questions.map((q, i) => answers[i] || "").join("|");

    // 1. Ask oracle to pre-approve the answer hash
    const hash = Array.from(
      buildAnswerHash(answerText, keypair.publicKey(), module.id)
    ).map(b => b.toString(16).padStart(2, "0")).join("");

    try {
      setStatus("Verifying with oracle…");
      const res = await fetch(`${ORACLE_URL}/approve-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId: module.id, answerText, learnerAddress: keypair.publicKey() }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        setStatus(`❌ ${error || "Wrong answer"}`);
        return;
      }

      // 2. Submit on-chain
      setStatus("Submitting on-chain…");
      await submitCompletion(keypair, module.id, answerText);
      setStatus("✅ Reward claimed!");
      onComplete(module.id);
    } catch (e) {
      setStatus(`❌ ${e.message}`);
    }
  };

  if (expired) return <p style={{ color: "#e74c3c" }}>⏰ Time expired for this module.</p>;

  const q = module.questions[step];

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h3>{module.title} — <span style={{ color: "#f39c12" }}>{module.reward}</span></h3>
      <CountdownTimer seconds={QUIZ_TIME} onExpire={handleExpire} />
      <p><strong>Q{step + 1}/{module.questions.length}:</strong> {q.q}</p>
      <input
        style={{ width: "100%", padding: 8, marginBottom: 8, boxSizing: "border-box" }}
        placeholder="Your answer…"
        value={answers[step] || ""}
        onChange={e => setAnswers(a => ({ ...a, [step]: e.target.value }))}
      />
      <div style={{ display: "flex", gap: 8 }}>
        {step < module.questions.length - 1
          ? <button onClick={() => setStep(s => s + 1)}>Next →</button>
          : <button onClick={submit}>Submit for reward</button>
        }
      </div>
      {status && <p style={{ marginTop: 8 }}>{status}</p>}
    </div>
  );
}

export default function App() {
  const [secretKey, setSecretKey]   = useState("");
  const [keypair, setKeypair]       = useState(null);
  const [completed, setCompleted]   = useState([]);
  const [loginErr, setLoginErr]     = useState("");

  const login = () => {
    try {
      setKeypair(Keypair.fromSecret(secretKey.trim()));
      setLoginErr("");
    } catch {
      setLoginErr("Invalid secret key");
    }
  };

  if (!keypair) return (
    <div style={{ maxWidth: 480, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h1>🌟 QuestXLM</h1>
      <p>Learn Stellar, earn XLM.</p>
      <input
        type="password"
        style={{ width: "100%", padding: 8, marginBottom: 8, boxSizing: "border-box" }}
        placeholder="Stellar secret key (S…)"
        value={secretKey}
        onChange={e => setSecretKey(e.target.value)}
      />
      <button onClick={login}>Connect Wallet</button>
      {loginErr && <p style={{ color: "red" }}>{loginErr}</p>}
    </div>
  );

  return (
    <div style={{ maxWidth: 640, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>🌟 QuestXLM</h1>
      <p style={{ color: "#666" }}>
        {keypair.publicKey().slice(0, 8)}…{keypair.publicKey().slice(-4)}
      </p>
      {MODULES.filter(m => !completed.includes(m.id)).map(m => (
        <QuizModule
          key={m.id}
          module={m}
          keypair={keypair}
          onComplete={id => setCompleted(c => [...c, id])}
        />
      ))}
      {completed.length === MODULES.length && (
        <h2 style={{ color: "#2ecc71" }}>🎉 All modules complete! Check your wallet.</h2>
      )}
    </div>
  );
}
