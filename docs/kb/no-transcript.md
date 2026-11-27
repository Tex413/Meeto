---
title: Why is no transcript appearing?
product: Meeteor
version: 2.1.0
tags: [troubleshooting, transcription, audio]
applies_to: Live transcript panel
---

## Short answer
Usually the wrong microphone is selected, the audio is too quiet or noisy and is skipped, Web Speech is unavailable, or the first-use model is still downloading.

## Steps
1. Check that the button shows **Stop**, which means the app is listening, and that the microphone level line moves when you speak.
2. Choose the correct microphone.
3. Select **Whisper**. **Web Speech** works only in Chrome and not in the desktop app.
4. Speak closer to the microphone and raise **Boost** if needed.
5. Open **Debug log**. Entries ending in **silent, skip** or **noise, skip** mean the audio was too quiet or unclear.
6. On the first use, allow time for the model download, then select **Start listening** again.
7. If a trial dialog appears, your trial time has ended.
