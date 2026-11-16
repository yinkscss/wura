# Wura demo shop (testnet)

A small Soroban contract you control, plus a page that points at it, for trying site connect end to end on Stellar testnet.

Tested: the contract builds to wasm, its 3 unit tests pass, and the flow below was run end to end (page → contract → agent picks `buy` → simulation shows the USDC → approve → paid on testnet).

## Contract

`contract/` is `init(token, seller, price)` once, then `buy(buyer, qty)` pays `price × qty` of the token to the seller. `shop.wasm` is a prebuilt copy, so you don't need Rust to deploy it.

To rebuild and test (needs Rust with the `wasm32v1-none` target):

```bash
cd contract && cargo test && cargo build --target wasm32v1-none --release
cp target/wasm32v1-none/release/wura_demo_shop.wasm ../shop.wasm
```

## Try it

1. Deploy a shop and a throwaway test "USDC" you control (from `web/`):
   `NODE_USE_ENV_PROXY=1 node --import tsx scripts/demo-shop-deploy.mts demo.json`
   This writes `demo.json` with the shop's contract ID and the test USDC issuer.
2. Run Wura with `MONEY_MODE=testnet`, `TESTNET_SIGNER=server-dev` (or Privy), an LLM configured, and `STELLAR_USDC_ISSUER=<usdcIssuer from demo.json>`.
3. Fund a buyer: `scripts/demo-shop-fund.mts <email> demo.json` (the email you sign in with; server-dev only).
4. Put the shop's ID into `index.html` in place of `REPLACE_WITH_CONTRACT_ID` and host it over https. Wura refuses private addresses, so use a public host or a tunnel.
5. In chat: "Connect to <your page> and buy 2 posters". Allow the site, review the card, approve.
