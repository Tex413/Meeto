# What still carries the old name

The product was renamed to **Verbatimely** on 2026-11-25. That step changed what people see: pages, titles, emails, app and checkout names, tool messages and documents. The items below keep an earlier name (Meetintel, Meeto or Meeteor) so that nothing live breaks and no user loses data.

## Data

| What | Where | Why it stays |
| --- | --- | --- |
| `meetintel.sqlite`, `meetintel.log` | `server.js`, files in `DATA_DIR` | Existing database and log; a new name would start an empty database. |
| Desktop data folder `%APPDATA%\meetintel` | `main.js` | Holds users' database, license, models and saved settings. It is now set explicitly so the new app name cannot move it. |
| `meeto-v1:` | password hashing in `server.js` | Changing it would invalidate every stored password. |
| `meetintel_sid` | session cookie in `server.js` | Changing it would sign everyone out. Visible only in browser developer tools. |
| `MEETINTEL-`, `MEETINTEL2-` | license keys: `server.js`, `tools/sign-license.js` | Start of every issued key, so **customers see it in their key**. A new prefix needs the app to accept both. |
| `meetintel-dev-secret` | fallback signing value in `server.js` | Keys signed with it must still verify. |
| `meetintel-` multipart boundary | `server.js` | Internal request separator that is never displayed; left alone as it is not user text. |

## Service, package and tool names

| What | Where | Why it stays |
| --- | --- | --- |
| `meetintel` package name | `package.json`, `package-lock.json`, `docker:build` image tag | Package id. The desktop data folder also uses it. |
| `io.meetintel.desktop` | `package.json` `appId` | The installer uses it to recognize an existing installation. |
| `meetintel`, `meetintel-cloudflared`, `meetintel_net` | `docker-compose.yml` services, containers, network and comments | The live deployment and tunnel route to these names. The admin guide quotes the service name. |
| Cloudflare tunnel `meeto` | live Cloudflare setup, `ROADMAP.md` | Live infrastructure. |
| `meeto` MCP server name, `MEETO_BASE_URL` | `mcp-server.js`, `README.md`, user manual | Existing MCP client configurations use them. **An MCP client may show the server name.** |
| `Meeto.vbs` | repository root | Desktop shortcuts may point to this file name. **People see it if they open the folder.** |
| `Meeteor` | repository, local folder paths (including `README.md` examples), internal project name | Never rename repositories or folders in this step. |

## Addresses

| What | Where | Why it stays |
| --- | --- | --- |
| `meetintel.io` links and `PUBLIC_URL` default | `activate.html`, `.env.example`, `docker-compose.yml`, `ROADMAP.md` | The live address. verbatimely.com is not bought or connected; that is the owner's step. |
| `https://meetintel.io/stripe/webhook` | `admin.html` setup instructions | The webhook address Stripe must call today. **Administrators see it.** |
| `noreply@meetintel.io` | `server.js`, `.env.example` | Sender address, so **password-reset recipients see it**. A deployment's `SMTP_FROM` overrides it. |

## Outside this repository

These were not changed or checked; each is a step for the owner:

- The live site at meetintel.io shows the old name until a release is deployed.
- Stripe account name, statement descriptor and any products already created in Stripe.
- DNS, the tunnel, the sending mailbox, and any `SMTP_FROM` display name in the live `data/.env`.

## Internal references

The `meetintel-inline-script-fragility` note named in `ROADMAP.md`, the rename test `tests/brand-rename.node-test.js` (it lists the old names in order to check for them) and this page mention the old names on purpose. Git history is unchanged.

## Before release

Owner ruling R5651 says a brand reaches customers only after the owner owns its domain, a search finds no product of that name in the same or a neighbouring market, and the owner approves it. The owner chose the name; the domain purchase and the search are not recorded here. Complete both before deploying this rename.
