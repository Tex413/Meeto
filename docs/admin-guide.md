# Meeteor administrator guide

Supported application runtime: **2.1.0** (`GET /version`). Meeteor's package and Windows installer carry the label `Meetintel` and version `2.0.0`; the Docker image and Compose service are named `meetintel`. Some screens, buttons and file names use the same label, and this guide quotes it only where you need to match it exactly. These labels do not mark a separate product or release.

## Read before you deploy

- **Network exposure.** Outside desktop mode the server listens on all network interfaces. Anyone who can reach the web app can create an account. Compose publishes port 7432 on the host. Limit access with a firewall or private network.
- **The desktop app has no login.** Its embedded server (default port 7433) listens only on `127.0.0.1`, so other computers cannot connect to it. Any program on the same computer that connects acts as the local user. Never put a proxy or tunnel in front of it.
- **Not a local-only product.** Meeting text can be sent to OpenAI or Anthropic. See "What leaves your computer" in the [user manual](user-manual/README.md). LM Studio, Claude Code and Codex are not selectable. Do not advertise a fully local AI backend or zero outbound meeting data for this build.
- **No consent step is enforced.** Your organisation must handle notice and consent before any capture.

## Install

### Requirements

Docker with Compose, or Node.js with npm for a source installation (the container image uses Node.js 20; the repository declares no minimum version). The server needs outbound internet access for AI calls and for the first download of the transcription and document-indexing models, which are cached under `DATA_DIR/models`. Users' browsers need access to the icon, voice and camera-model hosts listed in the user manual.

### Docker Compose

1. Copy or clone the repository.
2. Create `data/.env`. Compose requires the file to exist. Add only the settings you use, as described under [Configure](#configure). Restrict who can read it.
3. Set `PUBLIC_URL` in the shell that runs Compose, or in a `.env` file **beside `docker-compose.yml`**. For a local-only installation use `http://localhost:7432`. If you set nothing, Compose uses the default written in `docker-compose.yml`, a public address that is not yours. Compose's `environment` entry overrides `data/.env` for the container, so putting `PUBLIC_URL` only in `data/.env` does not change external links.
4. Run `docker compose up -d --build`.
5. Run `docker compose ps` and wait for the service to be healthy.
6. Open `http://localhost:7432/version` and confirm version `2.1.0`. `http://localhost:7432/auth/status` is the address the health check uses.
7. Open `http://localhost:7432` and create the first account.

Microphone and camera access in browsers generally requires HTTPS for any address other than `localhost`. Provide HTTPS if people connect from other computers.

The service stores everything in the host's `./data` directory, mounted at `/app/data`.

The optional `tunnel` profile starts `cloudflared` (`docker compose --profile tunnel up -d --build`). The Compose command reads its configuration from `data/cloudflared/config.yml`, so you must supply that file and whatever it references. The comments about `TUNNEL_TOKEN` in `docker-compose.yml` and `.env.example` do not match that command; this procedure has not been tested here.

### From source

1. In the repository folder, run `npm ci --no-audit --no-fund`.
2. Optionally create `data/.env` (see [Configure](#configure)).
3. Run `npm start`.
4. Open `http://localhost:7432`.

### Desktop app

- `npm run desktop` starts the Electron app from source. An unpackaged build skips the license check and opens developer tools; use it only for testing.
- `npm run dist` builds the Windows installer into `dist/`. Packaging does not test the build. Installer packaging was not exercised while writing this guide.
- A packaged app shows the activation screen until a valid license key is saved.
- The local server uses port 7433 unless `PORT` is set. If another program already uses `127.0.0.1` on that port, the app shows an error and quits; it does not close that program. Opening the app a second time focuses the running window.
- Data is in a `data` folder under Electron's `userData` directory for the app. The `Database ready:` line in `meetintel.log` shows the path.

## Configure

### Where settings are read from

| Setting | Read from | Purpose |
| --- | --- | --- |
| `PORT` | Process environment | Server port. Default 7432. |
| `PUBLIC_URL`, else `APP_URL` | Process environment | Base address for password-reset and checkout links. Default `http://localhost:<PORT>`. |
| `DATA_DIR` | Process environment | Data directory. Default `data` in the application folder. |
| `MEETEOR_LICENSE_SIGNING_PEM` | Process environment | License signing key. Needed only on the server that issues keys. |
| `MEETEOR_ADMIN_EMAIL` | Process environment or `DATA_DIR/.env` | The one account allowed to use `/admin`. |
| `LOCAL_CONTROL_TOKEN`, `LOCAL_CONTROL_ALLOW_TOKENLESS` | Process environment or `DATA_DIR/.env` | Remote start and stop. Read at startup. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | `DATA_DIR/.env` | Password-reset email. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `DATA_DIR/.env` | Checkout and webhook. Can also be saved from the admin console. |
| `EIA_API_KEY` | `DATA_DIR/.env` | Server-wide market data key. A user's own key in Settings takes precedence for manual refresh. |

For the local-control settings, `PUBLIC_URL` and `APP_URL` are also read from `DATA_DIR/.env`, with the process environment taking precedence.

**Do not leave unused or example lines in `data/.env`, even commented out.** The server's reader for admin, SMTP, Stripe and EIA settings can match a name inside a comment. Do not copy `.env.example` unchanged: its placeholder SMTP and Stripe values would count as configured. `LICENSE_SECRET` in that file is not used by the current code.

Handle every secret through your approved vault process. Never put a secret value in help material, tickets or chat.

AI provider, model and API keys are per account and are entered by each user in **Settings**. They are stored in the database in the data directory, so protect that directory.

### Set up the administrator

1. Register the administrator's account in the web app **first**.
2. Set `MEETEOR_ADMIN_EMAIL` to that account's email address.
3. Restart the server if you set it in the process environment. For Compose, run `docker compose up -d --force-recreate`.
4. Sign in with that account and open `/admin`.

While the setting is empty, nobody has access. Other accounts receive **Administrator access required**. Register before you set the name, so that nobody else can register that address first; the app does not verify email ownership.

### Password-reset email

1. Add the SMTP settings to `DATA_DIR/.env`. The port defaults to 587; port 465 uses a secure connection. Set `SMTP_FROM`, otherwise a default sender address that is not yours is used.
2. Request a reset for a test account and confirm the email arrives with a link that opens your server.

**Without `SMTP_HOST`, the reset link is written to the server log** and appears in the admin console. Anyone who can read the log can use a live link, so protect logs.

### Remote start and stop (Stream Deck, MCP)

The server exposes `POST /api/local/start-recording`, `POST /api/local/stop-recording` and the event stream `GET /api/local/events`. They start and stop **listening** in open app windows. All three accept only direct loopback requests; requests with proxy headers or a non-local `Host` or `Origin` are refused.

| Server | `LOCAL_CONTROL_TOKEN` | Public address (`PUBLIC_URL`/`APP_URL`) | Start and stop |
| --- | --- | --- | --- |
| Any | Set | Any | Allowed with `Authorization: Bearer <token>` |
| Desktop app | Not set | Not set or loopback | Allowed without a token |
| Source or Docker with `LOCAL_CONTROL_ALLOW_TOKENLESS=1` | Not set | Not set or loopback | Allowed without a token |
| Source or Docker without that opt-in | Not set | Not set or loopback | Refused (`local_control_token_required`) |
| Any | Not set | Not loopback | Refused |

1. Set a long random `LOCAL_CONTROL_TOKEN` and restart.
2. For MCP, set the same token in the MCP server's own environment (it does not read `DATA_DIR/.env`).
3. Set `MEETO_BASE_URL` for the MCP server. The default is `http://127.0.0.1:7432`; use port 7433 for the desktop app.
4. Configure the MCP client to run `node <application folder>/mcp-server.js`, or run `npm run mcp`.
5. With an app window open and signed in, test a start and a stop, and watch the screen. A successful response does not prove that a window received it; the response's `listeners` value shows how many were connected.

**Any deployment behind a proxy or tunnel must use a token and must not set the tokenless opt-in**, because some proxies make outside requests look local. The event stream takes no token. The command is sent to every connected window, not to one user.

**Docker:** a request from the host through a published container port normally reaches the app from a container-network address, not loopback, so expect these routes to be refused under the supplied Compose file. This was not tested here. Use a source or desktop installation for remote start and stop.

### Licensing and checkout

- License keys are signed with an Ed25519 private key, delivered through SecretsBoss as `MEETEOR_LICENSE_SIGNING_PEM`. It must pair with the public key built into the app. Without a matching key, no keys are issued and checkout does not open. Deliver it only to the server that issues keys.
- `tools/sign-license.js` is an offline signing utility that reads a private key file. Use it only under your approved secret-handling procedure.
- Checkout needs `STRIPE_SECRET_KEY` and a ready signing key. The success page issues the key for a paid checkout created by this application, and shows the same key if reloaded. Treat that page's address as sensitive.
- **The app does not email license keys.** The webhook route verifies the signature when both Stripe settings are present and logs the event type; it does not issue or deliver a key. A buyer who loses the success page needs your support process.
- The success page's instruction **Settings → License** does not match the app. Users activate from the trial dialog or the desktop activation screen.
- Prices are written in the application code and shown on the landing and admin pages. Review the landing page's claims before you expose it; some, including local-processing claims, do not match this build.
- Replacing the signing key requires a new app release with the matching public key. Keys signed with the old key stop working in that release.

### Trial limits and automatic deletion

Web accounts get 20 minutes of Whisper-transcribed audio and 2 document uploads. **The server automatically deletes the meetings, cards and documents of trial accounts about 7 days after the trial time is used up.** It checks hourly while running. The account itself remains and is marked **deleted** in the admin user list. Tell trial users, and back up if your policy requires recovery.

### Logs and meeting data

The server writes `DATA_DIR/meetintel.log` and standard output. It does not write transcript text there. Earlier builds did, so at each start the server replaces transcript text in that file with `[redacted]`. If it cannot, it logs a warning and starts anyway; fix the file's permissions and restart, or delete the file. This does not reach copies elsewhere, such as container logs, captured console output or backups. Delete any that cover builds that logged transcripts; recreating the Compose container discards its container log. The log can still contain account email addresses and, without SMTP, password-reset links.

**Deleting a meeting** removes its record, cards, cached research and recording file. If the recording file cannot be deleted, the app reports an error and keeps the meeting. Backups, logs and downloaded exports are not changed.

## Use the admin console

1. Sign in with the administrator account and open `/admin`.
2. **Overview:** check **Server running**, the counts for meetings and cards and documents, database size, uptime, and whether **Stripe** and **License signing** are ready.
3. **License Keys:** under **Generate Key**, choose the **Lifetime** or **Annual** plan, select **Generate**, then **Copy key** and deliver it through your approved process. To check a key, paste it under **Verify Key** and select **Verify**.
4. **Users:** review email, tier, trial time used and join date.
   - **Grant lifetime** (shown for accounts that are not paid) issues a lifetime license to that account. It needs a ready signing key.
   - **Reset pwd** asks you to type a new password of at least 6 characters and **sets it immediately**. It does not send an email. Give the password to the user privately and ask them to change it with **Forgot password?**
   - **Pending Password Resets** appears when users have unexpired reset links. Use **Copy** to deliver a link through an approved private channel, only after confirming who is asking.
5. **Stripe:** view masked status. To change it, enter the secret key and webhook secret through your approved process and select **Save Stripe config**. The page shows a webhook address on `meetintel.io`; use your own server's `/stripe/webhook` address, with the `checkout.session.completed` event.
6. **Settings:** **Sign out of Meetintel** ends your session after confirmation. **Back to App** returns to the main screen.

## Upgrade

No migration command or automatic rollback exists in this repository. The server adds missing database columns when it starts. Test an upgrade on a copy of the data first.

1. Record the `version` and `build` from `/version`, and keep a restorable copy of the current source or image.
2. Tell users, end active meetings, and stop capture. A restart signs everyone out.
3. Stop the application. For Compose, run `docker compose down`; the `data` directory stays on disk.
4. Back up the data directory as described below.
5. Install the new version:
   - **Compose:** update the source, check your `PUBLIC_URL` setting, then run `docker compose up -d --build`.
   - **Source:** update the source, run `npm ci --no-audit --no-fund`, then `npm start`.
   - **Desktop:** close the app and run the new installer.
6. Check `/version`, `/auth/status`, sign-in, a saved meeting, a document, and (desktop) a recording and the license.
7. If a check fails, stop the app and restore the previous application build **and** the backed-up data together.

After an upgrade that changes a screen, command or limitation, update the help files and reload them into the support tool ([help index](kb/README.md)).

## Backup and restore

The data directory (`DATA_DIR`) contains:

| Item | Contents |
| --- | --- |
| `meetintel.sqlite` | Accounts, settings including saved API keys and Microsoft sign-in tokens, meetings, transcripts, cards, to-dos, document text |
| `documents/` | Folder the app creates; uploaded document text is held in the database |
| `recordings/` | Desktop A/V recordings |
| `models/` | Downloaded transcription and indexing models; can be downloaded again |
| `.env` | Server configuration, which can contain secrets |
| `license.key` | Desktop license, when activated |
| `meetintel.log` | Server log |
| `cloudflared/` | Tunnel configuration, if you use that profile |

Browser-held items (wake word, injection mode, Context text) are not in this directory.

### Back up

1. End meetings and stop the application (`docker compose down`, stop the `npm start` process, or close the desktop app).
2. Copy the **whole** data directory to a protected location. For Compose, this is the host's `./data`.
3. Protect the copy like the original: it holds user content and credentials. Apply your retention policy, since deleting a meeting does not change old backups.
4. Start the application.

### Restore

1. Stop the application.
2. Move the current data directory aside; do not delete it until the restore is verified.
3. Copy the backup into place as the whole data directory, keeping its access restrictions.
4. Start an application version compatible with the backup.
5. Check sign-in, a saved meeting, a document and any recording.

A restore can bring back meetings that were deleted after the backup. Never put backup contents into help files. These backup and restore steps follow from where the code stores data; a full restore was not rehearsed while writing this guide.
