---
title: How do I use the room camera, and what does it detect?
product: Meeteor
version: 2.1.0
tags: [camera, privacy, room]
applies_to: Enable room camera button
---

## Short answer
The optional camera estimates the number of faces and detects a raised hand. It does not identify people, and the app does not save or send camera images. It is off each time the page loads.

## Steps
1. Tell the people in the room and confirm camera use is allowed.
2. Select **Enable room camera** and allow access.
3. Read the badge: **Camera active**, the number in the room, and **hand raised** when detected. There is no preview, and the app takes no action from these estimates.
4. Select the camera button again to turn it off.
5. For **Camera access denied**, allow camera access in your browser or operating system.
6. If the camera turns itself off, check **Debug log**; its detection models are downloaded from Google's servers and may be blocked.
