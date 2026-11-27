---
title: Does my meeting data leave my computer?
product: Meeteor
version: 2.1.0
tags: [privacy, data, ai]
applies_to: Settings, live meeting screen
---

## Short answer
Yes, it can. This build is not fully local: with an AI key saved, cards, spoken answers, extraction and transcript cleanup send meeting text to OpenAI or Anthropic, even when you use Whisper.

## Steps
1. Know what is sent to the AI provider: recent transcript, **Context**, matching document excerpts, questions and related on-screen card titles. **AI transcript cleanup** is on by default; clearing it stops only the cleanup requests, not cards or answers.
2. With Anthropic, company names heard in a meeting are also web-searched.
3. **Web Speech** sends audio to the browser vendor's speech service. Use **Whisper** to transcribe on the app's own server instead. In the web app, that server is the hosting server, which also stores your data.
4. **Send tasks** sends open action items to Microsoft.
5. With no AI key saved, these AI requests are not made, and cards, answers, extraction and cleanup do not work. The app still contacts market, news, model-download and icon services.
6. If meeting content must stay on your network, do not save an AI key, do not use **Web Speech** or **Send tasks**, and have your administrator review the installation. This has not been verified as a fully local setup.
