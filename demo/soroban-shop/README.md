# Wura demo shop (testnet)

A contract you control, plus a page that points at it, for trying site connect end to end.

**Not compiled or tested yet.** The machine this was written on had no Rust toolchain, so the contract below has not been built. Expect to fix small errors.

1. Install the Stellar CLI and Rust (`wasm32v1-none` target), then in `contract/`: `stellar contract build`.
2. Make a funded testnet identity: `stellar keys generate demo --network testnet --fund`.
3. Deploy: `stellar contract deploy --wasm target/wasm32v1-none/release/wura_demo_shop.wasm --source demo --network testnet`. Note the contract ID (starts with C).
4. Set it up with testnet USDC's contract ID, a seller address and a price (2 USDC = 20000000):
   `stellar contract invoke --id <SHOP> --source demo --network testnet -- init --token <USDC_CONTRACT> --seller <G_SELLER> --price 20000000`
   Get the USDC contract ID from the Circle testnet issuer in `src/server/network.ts` (the asset's contract ID for that issuer on testnet).
5. Put the shop's ID into `index.html`, host it over https (any static host), and run Wura with `MONEY_MODE=testnet`, an LLM configured, and your wallet set up with test USDC.
6. In chat: "Connect to <your page> and buy 2 posters".
