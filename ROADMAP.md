# Meetintel — Product Plan & Roadmap

> Living plan. Last updated 2026-06-04. Source of truth for direction so work can resume after any interruption.

## TL;DR direction (LOCKED)

Pivot from "hosted multi-user SaaS" to:

- **Free demo = the current hosted web app** at `meetintel.io` (try-before-buy funnel; to be capped).
- **Paid product = a downloadable Windows desktop app** (Electron `.exe`), **single-user, BYOK** (user brings their own OpenAI/Anthropic key), runs **100% local** on their machine.
- **Price: $69.99 one-time**, includes **1 year of updates**, works forever. No subscription. Optional paid update-renewal later for recurring upside.
- **License: Ed25519** asymmetric signing (offline-verifiable, no license server).
- **`meetintel.io` becomes:** marketing + "try the demo" + Stripe checkout + license delivery + installer download.

**Why:** owner's goal is "cash flow without ongoing headache." Self-hosted desktop = ~$0 marginal cost, no infra to babysit, no scaling wall. The original "your machine, your data" privacy copy becomes *true* in this model.

---

## Current status

**Live now** at `https://meetintel.io` (Docker + Cloudflare tunnel `meeto`, `--profile tunnel`). This is the hosted app that will become the **demo**.

**Done recently (on `main`):**
- Cloudflare tunnel deploy; HTTPS session-cookie fix.
- Fixed mojibake corruption in `index.html` + `charset=utf-8` on HTML responses.
- Context-aware transcript correction: local vocabulary layer + LLM refine pass (uses the Context box as a glossary).
- Insight cards: pin/delete controls **and DB persistence** (`pinned`/`deleted` columns; history hides deleted, pins float to top).

**Test login (hosted demo):** `patrickschooler@hotmail.com` (paid). Password was reset to a temp during setup — owner to change via "Forgot password".

---

## Pricing & licensing

- **$69.99 one-time**, 1 year of updates included, app works forever offline.
- Optional **update-renewal** (~$24.99/yr) can be added later — only *new updates* gated by a date baked into the signed license; app keeps working regardless. No phone-home required.
- **Discounts/promos:** make prices **editable config** (not hardcoded constants) + enable **Stripe promotion codes** (`allow_promotion_codes: true`) so owner can change pricing / run sales without redeploys. Optional admin "sale banner + strike-through" later.
- **License keys must switch from HMAC → Ed25519.** Current `generateLicenseKey`/`verifyLicenseKey` (server.js) use a shared HMAC secret — forgeable once the verify code ships in the app. Sign with a **private key the owner holds** (on the checkout/fulfillment backend); app verifies with an **embedded public key**.

---

## Desktop build — phases

### Phase 1 — Electron wrap + single-user refactor  ✅ DONE (commit ddde729)
- Electron main (`main.js`) boots the existing server on localhost:7433 and loads the UI in a `BrowserWindow`.
- `server.js` `DESKTOP_MODE`: provisions one local user, `checkToken` short-circuits → no login/accounts. Hosted mode unchanged when off (verified both ways).
- Data dir → Electron `app.getPath('userData')/data`. Port 7433 (avoids the 7432 demo).
- **Launch:** `npm run electron`. (Transcription needs the Phase-3 native rebuild; UI + non-Whisper features work now.)

### Phase 2 — Licensing
- Ed25519 sign/verify (replace HMAC). Owner holds private key; public key embedded in app.
- License payload: `{ plan, purchasedAt, updatesUntil }`. App runs forever; `updatesUntil` gates update access only.
- In-app activation UI (enter license key). Desktop app is **license-required to run** (the free trial lives on the web demo).

### Phase 3 — Installer
- `electron-builder` → NSIS `.exe`.
- **Native modules**: `@xenova/transformers` uses native `onnxruntime-node` → must `electron-rebuild` for Electron's ABI. `sql.js` is wasm (fine).
- **Whisper model** (`Xenova/whisper-base.en`): bundle in installer (~big) OR download on first run (needs internet once). Lean: first-run download to userData, like today.
- **Code-signing decision (owner):** buy cert (~$200–400/yr, no warning) OR ship unsigned (one-time SmartScreen "unknown publisher" prompt).

### Phase 4 — Site reframe + cap the demo
- Rewrite `landing.html`: honest positioning (download the desktop app; **bring your own AI key** stated clearly), Features (real ones), **Roadmap** section for unbuilt/"cool" features, pricing ($69.99 one-time), "Try the demo" CTA → hosted app.
- Stripe checkout: $69.99 one-time, `allow_promotion_codes: true`; on success deliver Ed25519 license + installer download link.
- **Cap the demo**: short sessions, limited/no persistence, low concurrency (host laptop only does ~3–6 concurrent live transcriptions — see Constraints).

---

## Needed from owner (for phases 2–4)
- 🎨 **App icon/logo** (PNG/SVG, 512×512+).
- 🔑 **Stripe live keys** (checkout for the $69.99 product). Admin settings already store Stripe keys.
- 🛡️ **Code-signing decision** (cert vs ship unsigned to start).

---

## Constraints & gotchas
- **Host is a laptop** (24 logical CPUs but only ~15.3 GiB RAM to Docker, mostly consumed by an existing localai stack; Whisper runs on CPU, not the GPU). Realistic **~3–6 concurrent live transcriptions**. Fine for a demo; not a scale host. → keep heavy work on customers' machines (desktop app); cap the demo.
- **`index.html` is one giant inline `<script>`** — a syntax error silently kills the whole app. Always validate it parses before deploying (`node -e` + `vm.Script` over the inline block). See memory `meetintel-inline-script-fragility`.
- **Deploy:** `docker-compose --profile tunnel up -d`. Rebuild after code changes: `docker-compose build meetintel && docker-compose up -d meetintel`.
- **Transcription is local Whisper** on the server (no third-party STT cloud). Keep offline; don't switch to a paid STT API.
- BYOK is unusual vs competitors (Fireflies/Otter/Fathom are fully managed) — a differentiator for technical buyers, but the site MUST say "bring your own AI key" up front to avoid refunds.

## Future / not now (roadmap candidates)
- Managed-AI tier ("$X/mo + AI usage") for the mass market — only if/when demand + real hosting justify the metered-billing + cost-controls build. Keep BYOK as the power-user path (hybrid).
- Microsoft To Do / Outlook task push (Graph code partially present — verify before advertising; currently roadmap, not "Connected").
- Live-panel card reload from DB mid-session (today pin/delete persistence reflects in saved history; the live panel is session-only).
