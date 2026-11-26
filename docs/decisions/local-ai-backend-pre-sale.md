# Is the LM Studio backend required before the first sale?

Task #22753, written 2026-11-25. **Decision: yes.** Meeteor is not sold, or described as local, until the LM Studio
backend ships and passes the gate below. The decision applies the owner's charter; it changes no price, code path or
public page.

## Owner action

> The public page `https://meetintel.io/landing` makes local claims this build does not meet. Approve removing them.

It needs the owner because it changes public text, and the owner's 2026-11-25 brief says meetintel.io stays as it is.
Recommendation: remove them now rather than wait for the backend. Fetched 2026-11-25 (HTTP 200), the page contained
"runs entirely on your machine", "No cloud. No subscription", "Bytes sent to the cloud" (shown with 0 in
`landing.html`), "audio ever leaves your machine" and "All processing local". The deployed server's code and checkout
were not inspected.

## Why

- Charter non-negotiables: the backend is switchable between LM Studio, Claude Code and Codex, and with a local backend
  no meeting audio, transcript or organisational data leaves the customer's network.
- The charter's current focus is the working-member loop "fully local", with the backend setting built first. The
  owner's market scan found the defensible ground to be a fully local, botless agent for teams that cannot use cloud
  bots.
- Selling first without the claim would mean selling to a different buyer than the charter describes.
- Claude Code and Codex do not satisfy the local claim here: it rests on a local backend. This record does not decide
  when those two must ship; the charter still requires them.

## Gate status (task #22959)

The LM Studio backend and its blocks are written, but **the gate has not passed**: no item has been observed on the
build to be sold. The tests added in `tests/` have not been run (no verification capacity was available). There has
been no run against a real LM Studio (no model was loaded when checked), no Docker image build or container
connection, and no network capture.

For item 4 on the Docker build, one way to capture the whole session is to run the browser in a container that shares
the app container's network (`--network container:meetintel`), with `tcpdump` attached to the same network. A single
capture then covers both screen and server.

## What the build did before task #22959

Settings offered only OpenAI and Anthropic. Observed by running `server.js` with a fake key and outbound requests
blocked:

| Action | Observed |
| --- | --- |
| Save provider `lmstudio` | Returns `ok`, but saves `openai` without saying so |
| Ask (`/proxy`) | Tries `api.openai.com/v1/chat/completions` |
| Refine a transcript turn (`/transcribe/refine`) | Tries `api.openai.com/v1/chat/completions` |
| Start with an empty data folder | Tries to download the Whisper model from `huggingface.co` |
| Idle for 40 s | Tries `api.eia.gov` and `query1.finance.yahoo.com` (market ticker, BKV quote) |

Read in the code, not run:

- While listening, `maybeAnalyze` sends recent transcript and matching document excerpts through `/proxy`.
- AI transcript cleanup (`aiRefineToggle`) is on by default.
- With the Anthropic provider, `extractEntities` sends transcript to the cloud, and `researchEntity` web-searches the
  company names it finds.
- The optional Web Speech mode uses the browser vendor's speech service (the screen calls it cloud-based).
- Sending tasks to Microsoft To Do sends action-item text to Microsoft Graph.
- In the hosted web mode, audio goes to the server, not only the participant's machine.

Whisper transcription itself runs in the server's own worker.

## Gate for the local claim

All of these, observed on the build that will be sold:

1. LM Studio can be selected in Settings and stays selected. The server address and model name are configuration, not
   fixed in code. An unsupported provider value is rejected, not replaced.
2. Every AI call uses it: cards, spoken answers, Test AI, company extraction and transcript cleanup (`/proxy` and
   `llmComplete`). If LM Studio fails, the user sees an error; nothing falls back to a cloud provider.
3. With it selected, Web Speech, cloud web research and Microsoft To Do sending are blocked by the app, not only hidden.
4. A whole session (screen and server: start, speak, ask, cards, documents, end) is captured at the network level.
   No meeting audio, transcript or organisational data goes outside the customer's network.
5. The claim says only that. It does not say "offline" or "0 bytes": model downloads, the market ticker and news,
   and screen assets from public hosts still use the internet unless they are separately removed or bundled and
   verified. It applies to an installation inside the customer's network, not the hosted web app.

A Docker installation must also be shown to reach LM Studio on its host or the customer's network.

## How to check

Run `node scripts/probe-outbound.js` (about 45 s). `OUTBOUND` lines are attempted destinations; nothing is sent by the
intercepted calls. The probe covers only server `https.request` and `fetch` calls for the steps in the table. It can
show that the gate fails, but passing it does not satisfy item 4.
