'use strict';

// The on-screen consent prompt and the A/V announcement clip (served as /consent-prompt.js).
// Rules live in consent-client.js; this file is the DOM and the devices.
(function (root) {
  const SPEECH_START_MS = 30000;   // the local voice may need to load before it can speak
  const SPEECH_MAX_MS = 120000;
  const CLIP_MAX_MS = 180000;      // the clip is for one announcement and answer only

  function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // Opens the microphone only (never the screen) and holds the audio in memory.
  async function startClip() {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const context = new AudioContext();
    const mix = context.createMediaStreamDestination();
    context.createMediaStreamSource(mic).connect(mix);
    const chunks = [];
    const recorder = new MediaRecorder(mix.stream);
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.start(500);
    await context.resume();

    function close() {
      mic.getTracks().forEach(track => track.stop());
      context.close().catch(() => { /* already closed */ });
    }

    return {
      context,
      mix,
      isLive: () => mic.getTracks().some(track => track.readyState === 'live'),
      discard() {
        recorder.ondataavailable = null;
        if (recorder.state !== 'inactive') recorder.stop();
        chunks.length = 0;
        close();
      },
      stop() {
        return new Promise(resolve => {
          recorder.onstop = () => { close(); resolve(new Blob(chunks, { type: recorder.mimeType })); };
          recorder.stop();
        });
      },
    };
  }

  // synthesize(text) -> Blob. speak() resolves only when the whole announcement has played, and
  // rejects while the voice is muted. speak.mute() silences a running announcement at once. With
  // a clip, the voice is also mixed straight into it, so it is recorded even on headphones.
  function createSpeaker({ synthesize, setSpeaking, isMuted, createAudio = url => new Audio(url) }) {
    const running = new Set();
    const MUTED = 'The voice is muted.';

    async function speak(text, { clip, signal }) {
      if (isMuted()) throw new Error(MUTED);
      const muting = new AbortController();
      running.add(muting);
      let url = null;
      let audio = null;
      const stop = () => { if (audio) audio.pause(); };
      try {
        const wav = await withTimeout(synthesize(text), SPEECH_START_MS, 'The voice did not load in time.');
        if (signal.aborted) throw new Error('cancelled');
        if (muting.signal.aborted) throw new Error(MUTED);
        url = URL.createObjectURL(wav);
        audio = createAudio(url);
        if (clip) {
          const source = clip.context.createMediaElementSource(audio);
          source.connect(clip.mix);
          source.connect(clip.context.destination);
        }
        setSpeaking(true);
        await withTimeout(new Promise((resolve, reject) => {
          const cancel = message => () => { stop(); reject(new Error(message)); };
          audio.onended = resolve;
          audio.onerror = () => reject(new Error('Audio playback failed.'));
          signal.addEventListener('abort', cancel('cancelled'));
          muting.signal.addEventListener('abort', cancel(MUTED));
          audio.play().catch(reject);
        }), SPEECH_MAX_MS, 'Playback did not finish.');
      } finally {
        running.delete(muting);
        if (url) {
          stop();
          setSpeaking(false);
          URL.revokeObjectURL(url);
        }
      }
    }

    speak.mute = () => running.forEach(muting => muting.abort());
    return speak;
  }

  // Returns prompt(preview, { needsClip, signal }) for createConsentController. Closing the
  // prompt by any route resolves { agreed: false }.
  function createConsentPrompt({ speak, onCaptureChange }) {
    let announcementClip = null;

    async function openClip() {
      const clip = await startClip();
      announcementClip = clip;
      onCaptureChange();
      return {
        ...clip,
        discard() { clip.discard(); announcementClip = null; onCaptureChange(); },
        async stop() {
          const blob = await clip.stop();
          announcementClip = null;
          onCaptureChange();
          return blob;
        },
      };
    }

    function prompt(preview, { needsClip, signal }) {
      const el = id => document.getElementById(id);
      const overlay = el('consentOverlay');
      const status = el('consentStatus');
      const play = el('consentPlayBtn');
      const readRow = el('consentReadRow');
      const read = el('consentReadAloud');
      const agreed = el('consentEveryone');
      const name = el('consentConfirmer');
      const allow = el('consentAgreeBtn');
      const speech = new AbortController();
      const session = root.ConsentClient.createAnnouncement({
        text: preview.announcement, needsClip, speak, startClip: openClip, signal: speech.signal,
      });
      let spoken = false;
      let speaking = false;
      let clipTimer = null;

      el('consentText').textContent = preview.announcement;
      el('consentDraft').textContent = preview.wordingApproved
        ? ''
        : `Draft wording, not approved by counsel (${preview.wordingVersion}).`;
      el('consentClipNote').style.display = needsClip ? '' : 'none';
      readRow.style.display = 'none';
      read.checked = false;
      agreed.checked = false;
      status.textContent = needsClip ? 'Nothing is captured yet.' : '';
      play.textContent = needsClip ? 'Start announcement clip and speak' : 'Speak again';
      overlay.style.display = 'flex';

      // The announcement counts once it was spoken in full, or the host says they read it.
      function announced() {
        const heard = spoken || (readRow.style.display !== 'none' && read.checked);
        return heard && (!needsClip || session.hasClip());
      }
      function refresh() {
        allow.disabled = speaking || !announced() || !agreed.checked || !name.value.trim();
        play.disabled = speaking;
      }

      async function announce() {
        speaking = true;
        status.textContent = 'Speaking the announcement…';
        refresh();
        try {
          const result = await session.announce();
          if (needsClip && !clipTimer) {
            clipTimer = setTimeout(() => {
              session.discard();
              spoken = false;
              read.checked = false;
              readRow.style.display = 'none';
              status.textContent = 'The announcement clip ran too long and was discarded. Start it again.';
              clipTimer = null;
              refresh();
            }, CLIP_MAX_MS);
          }
          if (result.spoken) {
            spoken = true;
            status.textContent = 'Announcement spoken. Collect everyone’s answer.';
          } else {
            readRow.style.display = '';
            status.textContent = 'The voice could not speak (' + result.error
              + '). Read the whole announcement aloud yourself.';
          }
        } catch (e) {
          status.textContent = 'The announcement clip could not start, so A/V recording stays off: ' + e.message;
        }
        speaking = false;
        refresh();
      }

      return new Promise(resolve => {
        let done = false;
        async function finish(yes) {
          if (done) return;
          done = true;
          clearTimeout(clipTimer);
          speech.abort();
          overlay.style.display = 'none';
          signal.removeEventListener('abort', decline);
          document.removeEventListener('keydown', onKey);
          const answer = { agreed: yes, confirmer: name.value.trim(), announcedBy: spoken ? 'speech' : 'host' };
          try {
            answer.clip = await session.finish(yes);
          } catch (e) {
            session.discard();
            answer.agreed = false;
          }
          resolve(answer);
        }
        function decline() { finish(false); }
        function onKey(e) { if (e.key === 'Escape') decline(); }

        signal.addEventListener('abort', decline);
        document.addEventListener('keydown', onKey);
        play.onclick = announce;
        read.onchange = refresh;
        agreed.onchange = refresh;
        name.oninput = refresh;
        allow.onclick = () => { if (!allow.disabled) finish(true); };
        el('consentDeclineBtn').onclick = decline;
        el('consentCloseBtn').onclick = decline;
        refresh();
        // A clip opens the microphone, so it waits for the host's click.
        if (!needsClip) announce();
      });
    }

    prompt.clipLive = () => !!announcementClip && announcementClip.isLive();
    return prompt;
  }

  const exported = { createConsentPrompt, createSpeaker };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.ConsentPrompt = exported;
})(globalThis);
