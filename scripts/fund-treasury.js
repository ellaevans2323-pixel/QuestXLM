// scripts/fund-treasury.js
// Called by GitHub Actions to top-up the on-chain treasury.
import {
  Keypair,
  Networks,
  Contract,
  SorobanRpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

const {
  ADMIN_SECRET,
  CONTRACT_ID,
  TOPUP_AMOUNT = "10000000",
  RPC_URL      = "https://soroban-testnet.stellar.org",
} = process.env;

if (!ADMIN_SECRET || !CONTRACT_ID) {
  console.error("ADMIN_SECRET and CONTRACT_ID are required");
  process.exit(1);
}

const admin    = Keypair.fromSecret(ADMIN_SECRET);
const server   = new SorobanRpc.Server(RPC_URL);
const contract = new Contract(CONTRACT_ID);

const account = await server.getAccount(admin.publicKey());
const tx = new TransactionBuilder(account, {
  fee: "100",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(contract.call(
    "fund_treasury",
    xdr.ScVal.scvI128(new xdr.Int128Parts({
      hi: xdr.Int64.fromString("0"),
      lo: xdr.Uint64.fromString(TOPUP_AMOUNT),
    })),
  ))
  .setTimeout(30)
  .build();

const prepared = await server.prepareTransaction(tx);
prepared.sign(admin);
const result = await server.sendTransaction(prepared);

console.log(`Treasury topped up with ${TOPUP_AMOUNT} stroops. tx: ${result.hash}`);
