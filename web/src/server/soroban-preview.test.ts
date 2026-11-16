import assert from "node:assert/strict";
import { test } from "node:test";
import { Address, Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { analyzeAuth, refusalFor, spendFor } from "./soroban-preview";

const USER = Keypair.random().publicKey();
const SHOP = Keypair.random().publicKey();
const SITE = StrKey.encodeContract(Buffer.alloc(32, 7));
const USDC = StrKey.encodeContract(Buffer.alloc(32, 8));
const XLM = StrKey.encodeContract(Buffer.alloc(32, 9));

const addr = (a: string) => nativeToScVal(a, { type: "address" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

function inv(contract: string, fn: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: fn, args }),
    ),
    subInvocations: subs,
  });
}
const transfer = (token: string, from: string, to: string, amount: bigint) => inv(token, "transfer", [addr(from), addr(to), i128(amount)]);
const entry = (root: xdr.SorobanAuthorizedInvocation) =>
  new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: root });

const describe = (c: string) => (c === XLM ? "XLM" : "an unknown token");

test("a purchase paying USDC through a nested transfer is read as the price", () => {
  const a = analyzeAuth([entry(inv(SITE, "buy", [], [transfer(USDC, USER, SHOP, BigInt(125000000))]))]); // 12.50 USDC
  const s = spendFor(a, USER, USDC);
  assert.equal(s.usdcCents, 1250);
  assert.deepEqual(s.other, []);
  assert.equal(refusalFor(a, s, describe), null);
  assert.deepEqual(a.calls.map((c) => c.fn), ["buy", "transfer"]);
});

test("USDC is rounded up to the next cent so a cap is never undercounted", () => {
  const a = analyzeAuth([entry(transfer(USDC, USER, SHOP, BigInt(100001)))]);
  assert.equal(spendFor(a, USER, USDC).usdcCents, 2);
});

test("a spend in another token is refused, whatever it is", () => {
  const a = analyzeAuth([entry(inv(SITE, "mint_nft", [], [transfer(XLM, USER, SHOP, BigInt(500000000))]))]);
  const s = spendFor(a, USER, USDC);
  assert.equal(s.usdcCents, 0);
  assert.equal(s.other.length, 1);
  assert.match(refusalFor(a, s, describe) ?? "", /XLM.*only spend USDC/);
});

test("transfers between other people don't count against the user, and incoming ones are shown", () => {
  const a = analyzeAuth([entry(inv(SITE, "buy", [], [transfer(USDC, SHOP, USER, BigInt(50000000)), transfer(USDC, SHOP, SITE, BigInt(90000000))]))]);
  const s = spendFor(a, USER, USDC);
  assert.equal(s.usdcCents, 0);
  assert.equal(s.incoming.length, 1);
});

test("standing-power calls are refused: approve, allowances, admin, upgrades", () => {
  for (const fn of ["approve", "increase_allowance", "set_admin", "transfer_from", "upgrade", "set_approval_for_all"]) {
    const a = analyzeAuth([entry(inv(SITE, "buy", [], [inv(USDC, fn, [])]))]);
    assert.match(refusalFor(a, spendFor(a, USER, USDC), describe) ?? "", new RegExp(fn), fn);
  }
});

test("a call that needs someone else's signature is refused", () => {
  const other = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(SHOP).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: inv(SITE, "buy", []),
  });
  const a = analyzeAuth([other]);
  assert.match(refusalFor(a, spendFor(a, USER, USDC), describe) ?? "", /other than yours/);
});

test("creating a contract from the user's account is refused", () => {
  const create = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractHostFn(
      new xdr.CreateContractArgs({
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new xdr.ContractIdPreimageFromAddress({ address: new Address(USER).toScAddress(), salt: Buffer.alloc(32) }),
        ),
        executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
      }),
    ),
    subInvocations: [],
  });
  const a = analyzeAuth([entry(create)]);
  assert.match(refusalFor(a, spendFor(a, USER, USDC), describe) ?? "", /deploys new code/);
});

test("a free call is fine", () => {
  const a = analyzeAuth([entry(inv(SITE, "claim", []))]);
  const s = spendFor(a, USER, USDC);
  assert.equal(s.usdcCents, 0);
  assert.equal(refusalFor(a, s, describe), null);
});
