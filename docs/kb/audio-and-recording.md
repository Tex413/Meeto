---
title: How do I choose the microphone and transcription settings?
product: Meeteor
version: 2.1.0
tags: [audio, transcription]
applies_to: STT, Mode and Audio controls
---

## Short answer
Pick a microphone, use **Whisper** (the default) or Chrome's **Web Speech**, and adjust the audio controls if speech is missed.

## Steps
1. Next to **STT**, choose **Whisper**, which transcribes on the app's server, or **Web Speech** (Chrome only, uses the browser vendor's cloud service).
2. Choose your microphone from the menu beside **Start listening**.
3. Leave **Echo**, **Denoise** and **AGC** on, or change them. If **Restart to apply** appears, select **Stop**, then **Start listening**.
4. If speech is missed, raise **Boost** (1 to 30, default 10). It applies immediately; its tooltip suggests turning off **AGC** when you set Boost yourself.
5. Set **Chunk** (3, 4, 6 or 8 seconds) to change the longest piece of audio Whisper receives.
6. Add names and terms to **Context** to help correct them, then check the transcript: ordinary words can be changed to similar Context words.
7. **Mode** does not identify speakers. **Everyone** is the default. In **Others only**, holding Space marks your lines, but your words are still used for cards. **Fact-check me** asks the AI to flag errors using the recent transcript from all speakers.
