---
title: Why did Meeteor not answer my spoken question?
product: Meeteor
version: 2.1.0
tags: [troubleshooting, voice, questions]
applies_to: Live meeting screen, wake word badge
---

## Short answer
The voice may be muted, the wake word may have been transcribed differently, the question may have run into an earlier one, or the AI or voice download failed.

## Steps
1. Check the wake word on the badge and make sure the app is listening.
2. Look in **Live transcript** to see how your wake word was written. If it is wrong, choose an ordinary first name as the **Wake word** and select **Save**.
3. Pause for at least 8 seconds, then say the wake word and question together.
4. Open **Debug log** and select **Test AI**.
5. If a card appeared but you heard nothing, check the bottom-right button: if it shows **Voice muted · Unmute**, select it and ask again. Otherwise check your speaker volume and internet connection; your browser must download the voice files the first time. Look for **Piper TTS failed** in the log.
