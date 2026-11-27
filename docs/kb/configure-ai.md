---
title: How do I set up and test the AI provider?
product: Meeteor
version: 2.1.0
tags: [settings, ai, getting-started]
applies_to: Settings, Test AI
---

## Short answer
Save an OpenAI or Anthropic key in **Settings**, then run **Test AI** with the **Debug log** open. These are the only two providers in this build.

## Steps
1. Select **Settings** (gear).
2. Choose **AI Provider** (**OpenAI** or **Anthropic (Claude)**) and a **Model**.
3. Paste the key into the field that matches the provider and select **Save**.
4. Reopen Settings and look for **✓ Key saved**. The key field itself is always blank.
5. Select **Debug log** (bug icon), then **Test AI**.
6. Look for **AI test passed** in the log. Success is shown only there. If it failed, read the log and any error card in **Insight cards**.
