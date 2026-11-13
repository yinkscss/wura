# Interface designs

Placeholder product name: **Agent** (the public name is not chosen yet). These are static HTML/CSS mockups, rendered to PNG. They are not a live product. Example balances, rates and payments in the screens are fictional preview data for a single wallet. Do not treat them as traction, users or revenue.

## Style

The look follows a deep blue + white + bubblegum pink interface, with a glowing white starfield and solid (not glass) white cards.

| Token | Hex | Use |
| --- | --- | --- |
| Deep blue | `#08318D` / `#092D8E` | Hero and sidebar backgrounds, text on light cards, primary outlines |
| Pure white | `#FFFFFF` | Text on blue, primary filled buttons on the hero, card surfaces |
| Bubblegum pink | `#FD91CC` | Sparse accent: key amounts, the daily-limit gauge, best-rate highlight, primary confirm buttons |

- Type: Plus Jakarta Sans (local files in `src/fonts/`), with Inter as a fallback. Headlines are weight 600–700, tight tracking.
- Cards: solid opaque white, 16–24px radius, soft deep shadows (`0 20px 40px rgba(0,0,0,.3)` and similar). No glassmorphism.
- Buttons: pills. Primary on blue is pink or white; confirm actions in chat are pink; secondary is an outline.
- Hero: deep blue fading to bright blue then white, with a glowing white particle / starfield arc.
- Marketing and funding layouts arrange cards on a **half-moon arc**: the centre card sits highest and in front, mid cards a step lower at about ±7°, far cards lower still at about ±13°, evenly spaced along the curve.

## Screens

All PNGs are under `shots/`. Desktop frames are 1440×900 at 2× (2880×1800). Mobile chat frames are 390×844 at 2× (780×1688). The overview collage is 1920×1080 at 2× (3840×2160).

| File | What it is |
| --- | --- |
| [shots/00-overview.png](shots/00-overview.png) | Collage of all screens on the blue starfield, arranged on a half-moon: landing at the apex, wallet and funding descending left, three phones descending right. |
| [shots/01-landing-desktop.png](shots/01-landing-desktop.png) | Landing. Headline “Your money, on chat.” Five cards on a half-moon: chat snippet, rate comparison (Aquarius highlighted), pink daily-limit gauge at the centre, payment link, recent activity. |
| [shots/02-chat-swap-approve.png](shots/02-chat-swap-approve.png) | Mobile chat. User says “Change ₦50,000 to dollars.” Agent shows a three-venue quote (Aquarius best, 31.20 USDC) with Approve / Cancel. |
| [shots/03-send-confirm.png](shots/03-send-confirm.png) | Mobile chat. User says “Send $20 to Tunde.” Confirmation card with fee, daily limit remaining, and per-payment cap. |
| [shots/04-payment-link.png](shots/04-payment-link.png) | Mobile chat. User asks for a ₦15,000 payment link. Card with a fictional `example.com` URL, Copy and Share. |
| [shots/05-dashboard-balance-limits.png](shots/05-dashboard-balance-limits.png) | Desktop wallet. NGN and USDC balances, daily-limit gauge, per-payment cap, transaction log, connected apps (Claude, ChatGPT, Telegram, WhatsApp — text labels and generic icons only, not official logos). Stat cards sit on a gentle arc. |
| [shots/06-onboarding-verify-once.png](shots/06-onboarding-verify-once.png) | Funding choice. USDC with no ID check, or naira with an identity check before the first top-up. The two cards fan outward on a shallow arc. |

HTML/CSS sources, the starfield asset, fonts and the Playwright render script live in `src/`. To re-render: from `src/`, run `node render.mjs` (needs Playwright/Chrome). Do not add the original reference video to this repository.

A sign-in screen is not in this set. When building the app, add one that matches this style (email + one-time code) using the auth path in [docs/auth.md](../docs/auth.md).
