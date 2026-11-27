---
title: How do I fix an AI error card?
product: Meeteor
version: 2.1.0
tags: [troubleshooting, ai]
applies_to: Insight cards panel, Settings, Test AI
---

## Short answer
The error card's title tells you what to check: the saved key, the account's credits, the model or the connection.

## Steps
1. **API key not configured** or **API key rejected**: open **Settings**, check the provider, paste the matching key and select **Save**.
2. **API account out of credits**: check billing in your OpenAI or Anthropic account.
3. **Rate limited**: wait; analysis tries again when there is new speech.
4. **Model not available**: choose another **Model** and select **Save**.
5. **Connection error** or **AI error**: check your internet connection, open **Debug log**, and select **Test AI**.
6. If the error followed transcription, listening has stopped; select **Start listening** again. On a first use, the transcription model may still be downloading, so wait and retry.
