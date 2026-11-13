# Meeteor administrator guide

Supported application runtime: **2.1.0** (`GET /version` in `server.js`). The package and Windows installer identify themselves as **Meetintel 2.0.0**; the Docker image and Compose service are named `meetintel`. These labels are present in the current repository and do not establish a separate release.

## Install

For Docker, install Docker with Compose, clone or copy this repository, and prepare `data/.env` with the configuration values your deployment needs. `docker-compose.yml` requires that file through `env_file`; keep it outside shared help material and restrict access. Run `docker compose up -d --build`. The service publishes port 7432 and bind-mounts `./data` to `/app/data`. Check `docker compose ps` and `http://localhost:7432/auth/status`; Compose's health check uses that endpoint. The optional `tunnel` profile is separate and requires its own Cloudflare configuration.

For a source installation, install the Node dependencies with `npm ci --no-audit --no-fund`, then run `npm start`. The default address is `http://localhost:7432`. `npm run desktop` starts the Electron desktop app for development; its local server defaults to port 7433 and stores data in the operating system's application data directory. A packaged Windows installer is built with `npm run dist`; packaging is not a documented substitute for testing a release build.

## Configure

`PORT` changes the server port. `PUBLIC_URL`, falling back to `APP_URL`, is used when constructing external reset and checkout links. `DATA_DIR` selects the directory for the SQLite database, uploaded documents, models, recordings, log, environment file, and license file. Compose sets these to 7432 and `/app/data` and defaults `PUBLIC_URL` to the value in `docker-compose.yml`; set a deployment-specific URL when external links are needed.

The application's Settings dialog lets each user select the currently implemented OpenAI or Anthropic provider, model, and associated key. The admin screen (`/admin`, available to administrator accounts) has Overview, License Keys, Users, Stripe, and Settings pages. It can generate or verify keys, grant a lifetime license, initiate a user password reset, and save Stripe configuration and a license signing secret. Handle all secret values through the approved vault workflow; this guide intentionally gives names only. The password-reset mailer reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` from `DATA_DIR/.env`. Stripe and license-signing configuration can also be entered in the admin screen. `tools/sign-license.js` is a signing utility; use it only with the approved secret-handling procedure.

The owner's planned LM Studio, Claude Code, and Codex selection is absent from the current Settings control. Do not advertise a fully local AI backend or zero outbound meeting data for this build.

## Upgrade

1. Record the currently running value from `/version` and retain a restorable copy of the deployed source or image.
2. Stop meeting capture and stop the application. For Compose, run `docker compose down` (the bind-mounted `data` directory remains on disk).
3. Back up `DATA_DIR` as described below before replacing the source or image.
4. Deploy the new source, run `npm ci --no-audit --no-fund` for a source installation or `docker compose up -d --build` for Compose, and start the application.
5. Check `/version`, `/auth/status`, sign-in, and a representative saved meeting and document. Restore the previous application build and backed-up `DATA_DIR` together if validation fails.

No migration or automatic rollback procedure is defined in this repository. Test upgrades with a copy of data before using them in production.

## Backup and restore

The database is exported by `sql.js` to `DATA_DIR/meetintel.sqlite`. Uploaded files and recordings live under `DATA_DIR/documents` and `DATA_DIR/recordings`; downloaded models and application configuration are also below `DATA_DIR`. Stop the application before copying the entire directory so the database export and files are consistent. For Compose, copy the host `./data` directory to a protected backup location. For desktop, copy the `data` directory under Electron's `userData` path. Preserve access controls because this directory may contain user content and configuration secrets. Restore by stopping the app, replacing the whole data directory with a compatible backup, restarting, and checking a saved meeting and document. Never put backup contents into Sulenna help files.
