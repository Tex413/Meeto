# Meeteor 2.1.0 documentation coverage

This inventory maps the source to customer help. A route used only by a screen is listed with that screen's task. Line numbers refer to the source at commit `13a73fb`. "UM" is a section of the [user manual](user-manual/README.md); articles are in `docs/kb/`.

| Source surface | Feature or route | Manual section; articles |
| --- | --- | --- |
| `login.html:204-233`, `reset.html:46-66`; `server.js:986-1054` | Create account, sign in, forgot and reset password, sign out; `/auth/*`, `/reset` | UM: Create an account, sign in, and sign out; `sign-in`, `reset-password` |
| `server.js:273-308, 1406-1409, 1646-1650, 1692-1697` | Trial time, document limit, automatic data deletion; `/trial/status` | UM: Trial and license; `free-trial` |
| `index.html:3599-3621, 3692-3711`, `activate.html:31-63`, `landing.html:1419-1435`, `success.html:108-131`; `server.js:966-984, 1056-1119, 1397-1404` | Activation, checkout, key copy, webhook; `/license/*`, `/checkout/*`, `/stripe/webhook` | UM: Trial and license; Admin: Licensing and checkout; `activate-license`, `license-key-rejected` |
| `index.html:3500-3597, 3643-3689, 2772-2795, 3129-3185`; `server.js:1272-1301, 1571-1617` | Provider, model, keys, setup card, Test AI, error cards; `/user/settings`, `/proxy` | UM: Set up the AI provider; Troubleshooting; `getting-started`, `configure-ai`, `ai-errors` |
| `index.html:819-866, 932-994, 1803-1837, 3470-3492` | Toolbar, panels, resize, debug log | UM: Find your way around the main screen |
| `index.html:878-930, 1643-1661, 1739-1801`; `server.js:550-615, 1619-1657` | Whisper, Web Speech, microphone, audio controls, listening modes, hold Space, vocabulary correction; `/transcribe` | UM: Set up transcription and audio; `audio-and-recording`, `microphone-denied`, `no-transcript` |
| `index.html:1122-1180, 2716-2750`; `server.js:1411-1445, 1659-1683` | Record, End, automatic save, AI transcript cleanup; `/meeting/start`, `/meeting/update`, `/meeting/end`, `/transcribe/refine` | UM: Run a meeting; `record-meeting`, `old-text-in-new-meeting` |
| `index.html:886-895, 929, 997-1019, 2797-3127`; `server.js:1502-1526` | Interval, terseness, cards, pin, delete, filter, auto-clear, cost estimate; `/card/save`, `/card/update` | UM: Use insight cards; `use-cards`, `no-cards` |
| `index.html:2467-2508, 2613-2714` | Wake word, spoken answer; `/documents/search`, `/api/intel-snapshot` | UM: Ask a spoken question; `ask-a-question`, `no-spoken-answer` |
| `index.html:2510-2611, 3626-3633`; `server.js:1362-1395` | Company research, injection mode, Speak and Dismiss; `/api/meeting-cache*` | UM: Company research and suggestions; `research-suggestions` |
| `index.html:859-865, 2149-2205, 3635-3641` | Presence orb, presenter view | UM: Show the presence orb to the room; `presenter-view` |
| `index.html:855, 2207-2311`; `server.js:947-954` | Room camera | UM: Use the room camera; `room-camera` |
| `index.html:868-874, 2026-2110, 3682-3686`; `server.js:730-908, 1303-1360` | Market prices, headlines, stock badge, EIA key; `/api/market-prices*`, `/api/energy-news`, `/api/stock-price/*` | UM: Follow the market strip; `market-strip` |
| `index.html:977-991, 3222-3291`; `server.js:617-646, 1685-1748` | Documents add and remove; `/documents*` | UM: Add documents for context; `add-documents`, `document-upload-fails` |
| `index.html:950-967, 1514-1639, 3425-3462`; `server.js:1565-1569` | To-dos, Extract, text and .ics export; `/meeting/todos` | UM: Manage action items; `action-items`, `todos-missing` |
| `index.html:3293-3423, 3464-3468`; `server.js:648-708, 1750-1826` | Microsoft To Do; `/msft/*`, `/open-url` | UM: Send action items to Microsoft To Do; `microsoft-to-do` |
| `index.html:845, 1182-1280`, `main.js`; `server.js:1447-1500` | Record A/V; `/recording/*` | UM: Record screen and audio; `record-av` |
| `index.html:1025-1056, 1282-1367, 1382-1497`; `server.js:1433-1438, 1528-1543` | History, playback, Generate transcript; `/meetings`, `/meeting/<id>`, `/meeting/transcript` | UM: Review past meetings; `history`, `generate-transcript` |
| `index.html:1499-1512`; `meeting-delete.js`; `server.js:1545-1548` | Delete meeting | UM: Delete a meeting; `delete-meeting` |
| `index.html:851`; `server.js:1550-1563` | Export CSV; `/export/csv` | UM: Export cards to CSV; `export-csv` |
| `index.html:852, 3198-3205` | Clear all | UM: Clear the live screen; `old-text-in-new-meeting` |
| `index.html:2015-2024`, `local-control.js`, `mcp-server.js`; `server.js:1121-1151` | Remote start and stop, MCP; `/api/local/*` | UM: Start and stop listening from another program; Admin: Remote start and stop; `remote-control`, `remote-control-not-working` |
| `admin.html:142-462`; `server.js:1178-1270` | Admin console; `/admin*` | Admin: Set up the administrator; Use the admin console |
| `landing.html` (served at `/landing`) | Marketing and pricing page; only checkout buttons are tasks | UM: Trial and license. Page claims are not repeated; see Admin: Licensing and checkout |
| `server.js:942-965` | Vendor assets, `/auth/status`, `/version` | Internal; Admin: Install, Upgrade |
| Outbound calls in `index.html`, `server.js`, `inference-worker.js` | Data flows | UM: What leaves your computer; `data-privacy` |
| Install, configuration, data layout: `Dockerfile`, `docker-compose.yml`, `package.json`, `server.js:19-43, 310-344`, `log-redaction.js` | Install, configure, upgrade, back up | Admin guide |
| `Meeto.vbs`, `scripts/*.js`, `tools/sign-license.js` | Developer and owner utilities | `Meeto.vbs` (a developer launcher for Electron) and `scripts/` are not customer features; the signing tool is in Admin: Licensing and checkout |

## Absent from this build

The charter's consent step, LM Studio, Claude Code and Codex backends, enforced source citations, plan, document and slide generation, cross-meeting project memory, connected organisational systems, instant voice mute and configurable avatar have no matching control in the screens or server. They appear only as limitations.

## Not verified

The screens were checked by reading their source, not by operating them in a browser. Calls to OpenAI, Anthropic, Microsoft, Stripe and mail servers, model downloads, the desktop app, Docker Compose, the installer, and backup and restore were not run. Loading into Sulenna and checking its answers are separate release steps that have not been run.
