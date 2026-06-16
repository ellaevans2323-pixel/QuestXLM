import {
  Contract,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  xdr,
  hash,
} from "@stellar/stellar-sdk";

const SERVER_URL  = process.env.REACT_APP_RPC_URL  || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.REACT_APP_CONTRACT_ID || "";
const NETWORK_PASSPHRASE = Networks.TESTNET;

export const server = new SorobanRpc.Server(SERVER_URL);

/** sha256(answerText + learnerAddress + moduleId) — mirrors oracle logic */
export function buildAnswerHash(answerText, learnerAddress, moduleId) {
  const enc = new TextEncoder();
  const data = enc.encode(`${answerText}${learnerAddress}${moduleId}`);
  return hash(data); // returns Buffer / Uint8Array
}

export async function submitCompletion(keypair, moduleId, answerText) {
  const account = await server.getAccount(keypair.publicKey());
  const contract = new Contract(CONTRACT_ID);

  const answerHash = buildAnswerHash(answerText, keypair.publicKey(), moduleId);

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "submit_completion",
        xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
          xdr.AccountID.publicKeyTypeEd25519(keypair.rawPublicKey())
        )),
        xdr.ScVal.scvU32(moduleId),
        xdr.ScVal.scvBytes(answerHash),
      )
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const result = await server.sendTransaction(prepared);
  return result;
}
