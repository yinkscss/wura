# Connecting to other blockchain sites

Wura should be able to connect to other blockchain sites when you ask it to — for example, “connect to this site and buy X”, or “go to this website, connect, and get this coin.”

This is a scoped stretch skill, not one of the three core buildathon demo skills (swap, send, payment links and balances). The chosen approach is contract discovery by reading the site, not driving a browser. On Stellar testnet (`MONEY_MODE=testnet`, with an LLM configured) the primary approach below is built. In mock mode only the fictional example sites work. Mainnet is refused. Site calls that spend anything other than USDC are refused for now, because only USDC is covered by the limits.

## Allow list, then approve every signature

Before Wura connects to any new site, it always asks first: “Connect to this site?” It also offers to add that site to your allow list.

- Allowlisted sites skip the “Connect to this site?” question the next time.
- Every payment or signature still needs your approval, even on an allowlisted site. The allow list is only permission to connect, not permission to sign.
- You can remove a site from the list at any time.

Spending limits and the transaction log still apply. If a request would go over a per-payment or daily cap, Wura should stop and say so, and it should not sign.

## Primary approach: scrape, find the contract, then call it

This is the chosen path for the first version of the skill.

1. You give Wura a link and say what you want done.
2. If the site is not on your allow list, Wura asks “Connect to this site?” and offers to add it.
3. It fetches the site’s page and the network calls that page makes, and looks for the Soroban contract address.
4. It checks that the contract is real and, where possible, verified — not just that some address appeared on the page.
5. It reads the contract’s function list and inputs from the on-chain contract spec. Soroban contracts publish this on-chain, so once the address is known the interface can be read from the network without further scraping.
6. It builds the transaction, simulates it, and shows a plain-language preview: what you are signing, the price, and the fees it knows about.
7. Only after you approve does it sign. The result goes in the transaction log.

This is cheaper and more reliable than operating the website in a browser. It also keeps the preview tied to a real, simulated transaction rather than to whatever the page happens to show.

## Secondary approach: act as the wallet

Where a site already supports WalletConnect (Reown) or Stellar Wallets Kit, Wura can act as your wallet instead of discovering the contract itself.

You still get the allow-list question before the first connection. The site then sends over the transaction, Wura shows the same kind of preview, and nothing is signed until you approve.

This is a good complement to contract discovery, because many Stellar sites already speak these wallet standards. It does not replace the allow list, the signing preview, or the spending limits.

## Later: a hosted browser (after the buildathon)

A later option is a hosted headless browser (Browserbase or Browserless style) that opens the site, clicks “connect wallet”, fills in the purchase, and waits for your approval in chat before it signs. You would see the chat, not the browser.

This is more flexible when a site has no clear contract, or when prices are calculated only in the page. It is also slower, more likely to break on captchas or redesigns, and more expensive to run. It is not the path to demo for this buildathon.

## Risks

- **Picking the wrong function.** A site may route a trade through extra steps, or calculate a price on its own servers, so the obvious contract function is not always the right one. Simulating the transaction before the preview should catch most of those mistakes. If the simulation fails or the result is unclear, Wura should stop and say so, not guess.
- **Malicious contracts and drainer sites.** A scam page can point to a contract that drains the wallet. The allow list, contract verification, a plain-language signing preview, and the spending limits are the main defences. One bad signature can still do serious damage, so Wura should be cautious with new sites and should never skip the preview.

## Rough infrastructure cost

These figures are rough estimates from earlier discussion, not verified quotes checked against current price pages. Treat them as order-of-magnitude guidance only.

- **Scraper and contract discovery (the chosen path).** Close to ordinary light hosting for the app and a small database, plus a few cents of AI use per lookup, plus the usual tiny Stellar network fees. No hosted-browser bill.
- **WalletConnect (Reown) and Stellar Wallets Kit.** Reown’s relay service has a free tier that should cover early use. Stellar Wallets Kit is open source and free.
- **Hosted browser (later).** A hosted browser service in the Browserbase or Browserless style is often around $20 to $100 a month for light use, then billed per browser-hour, plus AI cost for each step that has to read the page. This is the expensive option, which is one reason it stays post-buildathon.

Costs the product would have anyway — model use for ordinary chat, Stellar network fees, and whatever the naira partner charges for naira on-ramps — are not unique to this skill.
