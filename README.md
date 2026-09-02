# Meeto

Real-time AI meeting assistant — self-hosted web service.

```
npm install
npm start          # runs the web app at http://localhost:7432
```

## Local recording control (Stream Deck, MCP, other automation)

`server.js` exposes three loopback-only, unauthenticated endpoints for triggering the recording
already-open in a logged-in browser tab on the *same machine* — they are never reachable from
Meeto's hosted multi-user service, only from `127.0.0.1`/`::1`:

- `GET /api/local/events` — Server-Sent Events stream a browser tab subscribes to.
- `POST /api/local/start-recording`
- `POST /api/local/stop-recording`

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

Set `MEETO_BASE_URL` if Meeto isn't running on the default `http://127.0.0.1:7432`.
