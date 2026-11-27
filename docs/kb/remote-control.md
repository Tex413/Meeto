---
title: How do I start and stop listening from a Stream Deck or MCP client?
product: Meeteor
version: 2.1.0
tags: [mcp, stream-deck, remote-control]
applies_to: npm run mcp, local start and stop commands
---

## Short answer
A tool on the same computer can start and stop **listening** in an open app after your administrator sets it up. It does not create a saved meeting or start **Record A/V**.

## Steps
1. Ask your administrator to configure local control.
2. Get participant consent before any remote start.
3. Open the app and sign in. Select **Record** if you want the meeting saved.
4. For MCP, run `npm run mcp` through your MCP client. Use `start_meeting_recording` or `stop_meeting_recording`; despite the names, they control listening.
5. Confirm on the app's screen that the listening button changed. A success message alone does not prove an app window received the command.
