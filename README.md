# Meeto

Help: [Meeteor manuals and Sulenna knowledge index](docs/kb/README.md).

Real-time AI meeting assistant — self-hosted web service.

```
npm install
npm start          # runs the web app at http://localhost:7432
```

## Local recording control (Stream Deck, MCP, other automation)

`server.js` exposes three endpoints, with no login, for triggering the recording
already-open in a logged-in browser tab on the *same machine*:

- `GET /api/local/events` — Server-Sent Events stream a browser tab subscribes to.
- `POST /api/local/start-recording`
- `POST /api/local/stop-recording`

All three accept only a loopback connection with a loopback `Host` (`localhost`, `127.0.0.1` or `[::1]`), no
proxy headers (`X-Forwarded-For`, `-Host`, `-Proto`, `X-Real-IP`, `Forwarded`, `Via`, `CF-Connecting-IP`), no
non-loopback `Origin` and no cross-site `Sec-Fetch-Site`.

Those checks cannot detect a same-host proxy that rewrites `Host` and adds no forwarding headers (nginx's default
`proxy_pass http://127.0.0.1:7432` does this), so the two POST endpoints are **refused unless configured**:

| Server | `LOCAL_CONTROL_TOKEN` | `PUBLIC_URL` (or `APP_URL`) | Start/stop |
| --- | --- | --- | --- |
| any | set | any | needs `Authorization: Bearer <LOCAL_CONTROL_TOKEN value>` |
| desktop app | unset | unset or loopback | allowed without a token |
| `npm start` or Docker with `LOCAL_CONTROL_ALLOW_TOKENLESS=1` | unset | unset or loopback | allowed without a token |
| `npm start` or Docker without it | unset | unset or loopback | refused |
| any | unset | not loopback (Compose's default) | refused |

Set `LOCAL_CONTROL_TOKEN` to a long random value, and give the same value to each controller. For a server on your
own machine whose controller cannot send a token, set `LOCAL_CONTROL_ALLOW_TOKENLESS=1` instead. **That opt-in is
unsafe behind any proxy or tunnel**, and so is putting a proxy in front of the desktop app, which has no login.

The server reads these settings (and `PUBLIC_URL`/`APP_URL` for this check) at startup from its environment, then
from `DATA_DIR/.env`. The server logs which mode applies when start/stop is disabled or tokenless.

The event stream takes no token, because the browser tab cannot send one. It carries only start/stop signals and
cannot start capture, but through a header-less proxy an outsider could see when they happen and be counted in
`listeners`.

### MCP server

`mcp-server.js` wraps those two POST endpoints as MCP tools (`start_meeting_recording`,
`stop_meeting_recording`) over stdio, so any MCP client (Claude Desktop, Claude Code, etc.) can
trigger a recording directly.

```
npm run mcp
```

To point Claude Desktop at it, add to its MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "meeto": {
      "command": "node",
      "args": ["S:\\source\\repos\\Meeteor\\mcp-server.js"]
    }
  }
}
```

For Claude Code, add the same server via `claude mcp add meeto -- node S:\source\repos\Meeteor\mcp-server.js`
(adjust the path to wherever this repo lives).

Meeto must already be running (`npm start`) and logged in in a browser tab for either tool to have
any effect — the MCP server and the Stream Deck tile are just remote triggers for that existing
session, not a way to run Meeto headless.

Set `MEETO_BASE_URL` if Meeto isn't running on the default `http://127.0.0.1:7432`. If the server has
`LOCAL_CONTROL_TOKEN`, set it in the MCP server's environment too. A controller that cannot send the bearer header
(check your Stream Deck tile) only works with the tokenless local setup in the table above.
