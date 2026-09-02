#!/usr/bin/env node
// MCP server exposing Meeto's local recording control (see /api/local/* in server.js) as MCP
// tools, so Claude and other MCP clients can start/stop a meeting recording on this machine
// without going through the Stream Deck plugin. Runs over stdio, spawned by the MCP client -
// see README for how to point Claude Desktop/Code at this.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const MEETO_BASE_URL = (process.env.MEETO_BASE_URL || 'http://127.0.0.1:7432').replace(/\/$/, '');

async function postLocal(path) {
  const res = await fetch(`${MEETO_BASE_URL}${path}`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Meeto responded ${res.status} ${res.statusText} for ${path}`);
  }
  return res.json();
}

function toolResult(text) {
  return { content: [{ type: 'text', text }] };
}

function toolError(err) {
  return { content: [{ type: 'text', text: `Failed to reach Meeto at ${MEETO_BASE_URL}: ${err.message}` }], isError: true };
}

const server = new McpServer({ name: 'meeto', version: '1.0.0' });

server.registerTool(
  'start_meeting_recording',
  {
    title: 'Start meeting recording',
    description: 'Starts recording/transcribing in the Meeto desktop app already open on this machine.',
  },
  async () => {
    try {
      await postLocal('/api/local/start-recording');
      return toolResult('Meeto recording started.');
    } catch (err) {
      return toolError(err);
    }
  }
);

server.registerTool(
  'stop_meeting_recording',
  {
    title: 'Stop meeting recording',
    description: 'Stops recording/transcribing in the Meeto desktop app already open on this machine.',
  },
  async () => {
    try {
      await postLocal('/api/local/stop-recording');
      return toolResult('Meeto recording stopped.');
    } catch (err) {
      return toolError(err);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
