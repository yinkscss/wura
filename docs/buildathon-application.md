# Stellar Nigeria Buildathon — application draft

This is a draft for the official Google Form. It has not been submitted. Do not treat anything here as a sent application.

- Short link: https://bit.ly/stellar-buildathon
- Form: https://docs.google.com/forms/d/e/1FAIpQLSf29BJ5Oto9R7PS_foAbfVzZmn6LYeolic34l1ryY1H-T3JfA/viewform
- Also: https://forms.gle/5LWxUiBJtxM6pNRM9
- Announcement: https://x.com/Stellar_Nigeria/status/2120474795737321758 (11 November 2026, Africa/Lagos)
- Form title: **Stellar Buildathon Application**
- Only the team lead should submit. One registration per team.
- You must be a [Builder’s Circle](https://bit.ly/stellarwabcircle) member in Ghana or Nigeria.
- No word or character limits were set on the form fields. Answers below are kept short on purpose.
- The form and the announcement graphics do not name separate tracks, and they do not publish a judging rubric. The closest “track” signal is the Stellar features checklist (Q17).

## Key dates and prizes

From the announcement graphics and the form:

| When | What |
| --- | --- |
| 21 November 2026 | Applications close |
| 25–30 November 2026 | Virtual Build Week: workshops, office hours, hands-on building |
| 1 December 2026 | Project submission deadline (if selected) |
| 4 or 5 December 2026 | In-person Builder Showcase in Accra or Lagos. Top 10 teams per chapter pitch. |

Prize path: the top two eligible projects from each location are recommended for SCF Instawards of up to $15,000 in XLM per project.

Eligibility to *win*: previous SCF funding recipients, Instawards sprint participants, and people currently in the SCF or Instawards pipeline are not eligible to win. They may still take part, learn, and refine a project. Eligibility will be verified before winners are selected. Team size is up to 4.

## Product name (not a form field)

The product name is **Wura**. Use that name in the answers below.

## Fields that need your input before submit

Please fill or confirm these before anyone sends the form:

- **Email address** — draft uses the Git author address; confirm it is the one you want official mail to go to.
- **WhatsApp number / handle** — not in the repo; you need to add this.
- **Social media handle** (X, Instagram, or LinkedIn) — not drafted; add the one you want them to use.
- **Are you a member of Stellar Builder’s Circle?** — required to take part. If not, apply first at https://bit.ly/stellarwabcircle.
- **Are you building solo?** — and, if not, team name, team size (including you, max 4), and team members (name + email).
- **Have you taken part in a Stellar program before?** (SCF, hackathons, residency, etc.) — please answer honestly. If you have received SCF funding, been in an Instawards sprint, or are currently in the SCF or Instawards pipeline, you can still apply and take part, but you would not be eligible to win.
- **Can you attend the virtual workshops and office hours?** (25–30 November)
- **If selected in the Top 10, can you attend the in-person showcase on 4 or 5 December in Lagos?**

The drafted answers below assume a solo lead from Lagos, and leave the unknown personal fields marked `[needed]`. Change them if a team is joining.

---

## Draft answers

Product name used in this draft: **Wura**. Nothing is live. There are no users, no revenue, and no transactions. The GitHub repo holds the product write-up, interface mockups, and a first web app preview that runs in mock mode.

### 1. Full Name *(required, short)*

Olayinka Olurotimi-Shittu

### 2. Email Address *(required, short)*

[needed — confirm] olayinkashittu2003@gmail.com

### 3. WhatsApp Number / Handle *(required, short)*

[needed]

### 4. Country of Residence *(required, choose one)*

Nigeria

### 5. What city are you located in? *(required, short)*

Lagos

### 6. GitHub Link *(required, short)*

https://github.com/yinkscss

### 7. Social Media Handle (X/Instagram/Linkedin) *(required, short)*

[needed]

### 8. What best describes you? *(required, checkboxes; last option is Other)*

Frontend Developer; Backend Developer

*(You are a full-stack AI engineer. These two boxes cover that. Add Other: “Full-stack / AI engineer” only if you want it spelled out.)*

### 9. Are you a member of Stellar Builder’s Circle? *(required, Yes / No)*

[needed — must be Yes to take part. If No, apply at https://bit.ly/stellarwabcircle first.]

### 10. Are you building Solo? *(required, No / Yes)*

[needed — draft assumes Yes if no one else is confirmed]

### 11. Team Name *(optional, short)*

[leave blank if solo; otherwise add a team name]

### 12. Team Size, including you *(optional, short)*

[leave blank if solo; otherwise a number from 2 to 4]

### 13. Team members (name+email) *(optional, paragraph)*

[leave blank if solo; otherwise one name and email per line]

### 14. Describe your project in one sentence *(required, short)*

Wura is a money assistant you chat with, which swaps naira and USDC on Stellar at the best rate it can find, pays people, and only moves money after you approve.

### 15. What problem are you solving? *(required, paragraph)*

People in Nigeria already want to move between naira and dollars, pay someone, or collect a payment, from the chat apps they use every day. Doing that today usually means leaving the conversation, shopping around for a rate, and trusting an app to move the money. Several WhatsApp and Telegram bots already do parts of this, but they typically ask for a BVN or NIN up front, and they do not show a side-by-side comparison of Stellar venues before you approve.

Wura is a single money assistant that works in Claude and ChatGPT as well as on Telegram and WhatsApp. You can start with USDC and no identity check, or top up naira through an on-ramp. It compares rates across Stellar venues, shows a clear quote, and waits for your approval. It also has per-payment and daily limits, and a transaction log. Trading and other extra skills are out of scope for this buildathon. A scoped stretch skill, if there is time after the core demo, is letting you connect Wura to another Stellar site: it always asks before connecting a new site and can add it to an allow list, then finds the Soroban contract, simulates the transaction, and still waits for your approval before it signs.

This is still early. A first web preview exists in the repo in mock mode. It has no users, no revenue, and no transactions yet.

### 16. How will your project use Stellar? *(required, paragraph)*

Stellar is the settlement and routing layer, not a bolt-on. Users hold USDC (and naira, once on-ramped) in a Stellar wallet created at sign-in with a Privy email one-time code, which maps an email to a classic `G…` address. The agent then:

- Compares quotes across Stellar’s built-in exchange (SDEX), Soroswap, and Aquarius, and picks the best path. That routing layer is built on the logic of StellarRoute, an open-source router I maintain (https://github.com/StellarRoute/StellarRoute). StellarRoute itself is not deployed, so the agent does this comparison itself and does not call a live StellarRoute service.
- Swaps naira and USDC, sends payments, and creates payment links on Stellar, only after the user approves the preview.
- Records each result in a transaction log, and refuses any request that would go over a per-payment or daily limit.

Naira funding would use LINK, a Stellar anchor, for on-ramping. USDC funding needs no identity check. For naira, the plan is a one-time identity check, with reuse only if LINK allows it; if that is not confirmed in time, the demo will say so and keep the USDC path as the no-ID start.

### 17. Which Stellar features do you plan to integrate? *(required, checkboxes; last option is Other)*

- Payments and Stablecoins
- Agentic Payments
- Soroban Smart Contracts

*(Soroban is on the list because the routing layer will quote Soroswap and Aquarius, which are Soroban venues, as well as SDEX. The first version uses a classic Stellar account, not a passkey or smart wallet. Passkeys / smart wallets are a later option, not this buildathon’s default sign-in.)*

*(Roadmap, for the pitch rather than this form: after the buildathon Wura plans to move from Privy to its own passkey-controlled Soroban smart wallet, so the per-payment and daily caps for Wura’s agent key are enforced by the wallet contract itself. See [Wallet roadmap](wallet-roadmap.md).)*

### 18. Link to the Project Repository *(optional, short)*

https://github.com/yinkscss/stellar-money-agent

The repository is private. It currently holds the product write-up, interface mockups, and a first web app preview that runs in mock mode. Nothing is live, and there are no users, revenue, or real transactions. I can share access with judges on request.

### 19. Your experience building on Stellar *(required, choose one; last option is Other)*

Built small projects

*(I maintain StellarRoute, an open-source Stellar routing project. It is not deployed as a live product, so I am not claiming to have shipped a product on Stellar.)*

### 20. Have you taken part in a Stellar program before? (e.g SCF, hackathons, residency program) *(required, Yes / No)*

[needed — answer honestly. See the eligibility note at the top if you have SCF or Instawards history.]

### 21. Can you attend the virtual workshops and office hours? *(required)*

[needed — options: Yes / No / Some of them. Virtual Build Week is 25–30 November 2026.]

### 22. If your team is selected among the Top 10, will you be available to attend the in-person Builder Showcase on December 4th or 5th in Accra, Ghana, or Lagos, Nigeria? *(required, Yes / No)*

[needed — for a Lagos applicant this would be the Lagos date. Please confirm you can attend.]

### 23. Anything else we should know? *(optional, paragraph)*

For this buildathon I will ship three skills end to end: swap naira and USDC at the best quoted rate, send or pay someone, and create a payment link plus check balances. Safety is part of the demo, not a hidden setting: a side-by-side rate comparison, a quote you approve before anything moves, per-payment and daily limits, and a transaction log.

A scoped stretch after those three skills is site connect: you can ask Wura to connect to another Stellar site, it always asks before connecting a new one and can save it to an allow list, then it finds the contract, simulates the call, and still needs your approval before it signs.

The planned demo path is: fund with USDC (no ID), optionally top up naira if the on-ramp check can be shown honestly, ask Wura to swap or pay, see the comparison and quote, approve, then see the result in the log. If the site-connect stretch is ready, show the allow-list question and a simulated contract preview as well, without letting it overshadow the three core skills.

I am a full-stack AI engineer in Lagos, currently at Ivinex. I also maintain StellarRoute. The product is called Wura. I am happy to walk judges through the private repo, the mockups, and the mock-mode web preview.

---

## Demo and scope (for your own prep; not a form field)

Three skills, plus visible safety, as in `docs/buildathon.md`. Site connect (allow list, then scraper / contract discovery) is a scoped stretch, as in `docs/site-connect.md`. Trading, small-business, and SEO skills stay off the pitch.

Differentiators to keep in the pitch, not as invented traction: the same assistant in Claude and ChatGPT as well as WhatsApp and Telegram; best-rate routing across Stellar venues; approve-before-act, limits, and a log as one consumer product; USDC with no ID, and a one-time naira check only where the on-ramp allows it. Closest live comparison is WhatsApp/Telegram naira bots such as Chainpaye, which do not combine those four points.

This draft does not mention GoodBuildit. That product stays the Celo / GoodBuilders pitch and should not be reused here.
