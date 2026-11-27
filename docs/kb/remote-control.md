---
title: How do I start and stop listening from a Stream Deck or MCP client?
product: Meeteor
version: 2.1.0
tags: [mcp, stream-deck, remote-control]
applies_to: npm run mcp, local start and stop commands
---

## Short answer
A tool on the same computer can ask an open app to start **listening**, or stop it, after your administrator sets it up. A remote start never gives consent: without it, the app only opens **Consent before capture** and captures nothing. It does not start **Record A/V**.

## Steps
1. Ask your administrator to configure local control.
2. Have someone at the screen: they complete the [consent step](meeting-consent.md) with everyone present.
3. Open the app and sign in. A remote start creates a meeting if none is active.
4. For MCP, run `npm run mcp` through your MCP client. Use `start_meeting_recording` or `stop_meeting_recording`; despite the names, they control listening.
5. Confirm on the app's screen that the consent dialog opened or the listening button changed. A success message alone does not prove an app window received the command.
