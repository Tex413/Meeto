---
title: Why is remote start or stop refused or doing nothing?
product: Meeteor
version: 2.1.0
tags: [troubleshooting, mcp, remote-control]
applies_to: npm run mcp, local start and stop commands
---

## Short answer
Commands must come directly from the same computer and be allowed by the server's local-control setting; an app window must also be open.

## Steps
1. If nothing changes, open the app, sign in and keep the window open.
2. For a `401` response, ask your administrator to make the controller's token match the server's. Do not send the token to support.
3. For `403` or `local_control_token_required`, ask your administrator to check local-control setup.
4. Check the MCP client's `MEETO_BASE_URL`: the default is `http://127.0.0.1:7432`; the desktop app uses port 7433 by default.
5. Do not connect through a proxy, tunnel or another computer. The supplied Docker setup is also likely to refuse these commands.
