'use strict';

// Playback of spoken answers with an instant mute. The charter requires that the AI voice can be
// muted at once, so every clip keeps a handle here until it ends, and muting also cancels clips
// that are still being synthesized. Loaded by index.html in the browser and by the tests in Node.
(function expose(root) {
  const STORAGE_KEY = 'voiceMuted';

  function createSpokenAudio({ synthesize, createAudio, createUrl, revokeUrl, storage, onPlaying, onIdle, log }) {
    const playing = new Set();
    let muted = storage.getItem(STORAGE_KEY) === '1';
    let muteCount = 0; // a clip requested before the latest mute is never played, even after unmuting

    function release(clip, why) {
      if (!playing.delete(clip)) return;
      revokeUrl(clip.url);
      log('Piper TTS ' + why);
      if (playing.size === 0) onIdle();
    }

    async function speak(text) {
      if (muted) {
        log('Piper TTS skipped (voice muted)');
        onIdle();
        return;
      }
      const requestedAt = muteCount;
      let clip = null;
      try {
        const wav = await synthesize(text);
        if (requestedAt !== muteCount) {
          log('Piper TTS discarded (muted while preparing)');
          if (playing.size === 0) onIdle();
          return;
        }
        const url = createUrl(wav);
        clip = { url, audio: createAudio(url) };
        playing.add(clip);
        clip.audio.onplay = () => { if (playing.has(clip)) onPlaying(); };
        clip.audio.onended = () => release(clip, 'finished');
        clip.audio.onerror = () => release(clip, 'playback error');
        await clip.audio.play();
      } catch (e) {
        // Pausing a clip that is still starting rejects play(); that is the mute working, not a failure.
        if (requestedAt === muteCount) log('Piper TTS failed: ' + e.message);
        if (clip) release(clip, 'stopped');
        else if (playing.size === 0) onIdle();
      }
    }

    function setMuted(next) {
      muted = Boolean(next);
      if (muted) {
        muteCount += 1;
        for (const clip of playing) {
          clip.audio.pause();
          release(clip, 'stopped (voice muted)');
        }
      }
      // Saved last: a storage failure must never keep the audio playing.
      storage.setItem(STORAGE_KEY, muted ? '1' : '0');
    }

    return { speak, setMuted, isMuted: () => muted };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createSpokenAudio };
  else root.createSpokenAudio = createSpokenAudio;
})(globalThis);
