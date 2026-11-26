'use strict';

// Browser side of the meeting consent gate (served as /consent-client.js, also loaded by
// node:test). It decides when to ask and when capture must stop; the page supplies the
// devices and the prompt. Nothing here is remembered across meetings or page loads.
(function (root) {
  // api: { preview(meetingId, modes), grant(body), withdraw(meetingId, reason) }
  // prompt(preview, { needsClip, signal }) -> { agreed, confirmer, announcedBy, clip }
  // stopCapture() must synchronously close every capture device.
  function createConsentController({ api, prompt, stopCapture, isRecording, onError }) {
    let record = null;        // the live consent record, if any
    let generation = 0;       // bumped whenever capture must stop, to void in-flight starts
    let pending = null;       // AbortController of the open prompt

    function allows(mode, meetingId) {
      return !!record && record.meetingId === meetingId && record.modes.includes(mode);
    }

    // Take before awaiting a device; if it then returns false, close what was just opened.
    function ticket(mode, meetingId) {
      const taken = generation;
      return () => taken === generation && allows(mode, meetingId);
    }

    // Closes devices first: telling the server must never delay or prevent stopping.
    function halt() {
      const was = record;
      record = null;
      generation += 1;
      if (pending) pending.abort();
      stopCapture();
      return was;
    }

    async function tellServer(meetingId, reason) {
      try {
        await api.withdraw(meetingId, reason);
      } catch (e) {
        onError(`Capture is stopped, but saving "${reason}" for meeting ${meetingId} failed: ${e.message}`);
      }
    }

    async function withdraw(reason = 'withdrawn', meetingId = null) {
      const was = halt();
      const id = was ? was.meetingId : meetingId;
      if (id) await tellServer(id, reason);
    }

    // The meeting is over. The server closes its records in /meeting/end.
    function end() { halt(); }

    // Resolves to null (capture must stay off) or { record, clip }. Asks when the live record
    // does not cover every requested mode for this meeting, and for every new A/V recording,
    // because each recording must contain its own announcement.
    async function ensure(meetingId, modes) {
      if (!meetingId || pending) return null;
      if (record && record.meetingId !== meetingId) halt();
      const needsClip = modes.includes('recording') && !isRecording();
      if (!needsClip && modes.every(mode => allows(mode, meetingId))) return { record, clip: null };

      const asked = new AbortController();
      pending = asked;
      const taken = generation;
      let answer = null;
      try {
        // A stopped recording is not carried over: starting it again is announced again.
        const carried = (record ? record.modes : []).filter(mode => mode !== 'recording' || isRecording());
        const preview = await api.preview(meetingId, [...new Set([...carried, ...modes])]);
        if (taken !== generation) return null;
        answer = await prompt(preview, { needsClip, signal: asked.signal });
        if (taken !== generation) return null;
        if (!answer || !answer.agreed) {
          await withdraw('declined', meetingId);
          return null;
        }
        const granted = await api.grant({
          meetingId,
          modes: preview.modes,
          wordingVersion: preview.wordingVersion,
          destinationKey: preview.destination.key,
          confirmer: answer.confirmer,
          announcedBy: answer.announcedBy,
          announcementRecorded: preview.modes.includes('recording') && (!!answer.clip || isRecording()),
          everyoneAgreed: true,
        });
        if (taken !== generation) {
          // Stopped while the grant was in flight: the new record must not stay open.
          await tellServer(meetingId, 'withdrawn');
          return null;
        }
        record = granted;
        return { record, clip: answer.clip || null };
      } catch (e) {
        onError(`Consent could not be recorded, so capture stays off: ${e.message}`);
        return null;
      } finally {
        if (pending === asked) pending = null;
      }
    }

    // Late arrival or a new destination: stop everything, apply the change while nothing is
    // captured or shared, then announce again. Capture restarts only if everyone agrees.
    async function reask(reason, { activeModes, restart, change = async () => {} }) {
      if (!record) { await change(); return false; }
      const { meetingId, modes } = record;
      const active = activeModes.filter(mode => modes.includes(mode));
      await withdraw(reason);
      await change();
      if (!active.length) return false;
      const again = await ensure(meetingId, active);
      if (!again) return false;
      await restart(active, again.clip);
      return true;
    }

    return {
      ensure,
      allows,
      ticket,
      withdraw,
      end,
      reask,
      cancelPrompt: () => { if (pending) pending.abort(); },
      current: () => record,
      isAsking: () => !!pending,
    };
  }

  // One announcement: speak it and, for A/V recording, hold a clip of only that exchange.
  // speak(text, { clip, signal }) rejects if speech fails. startClip() opens the clip
  // recorder: { stop() -> Promise<Blob>, discard() }.
  function createAnnouncement({ text, needsClip, speak, startClip, signal }) {
    let clip = null;
    let closed = false;

    function discard() {
      if (clip) clip.discard();
      clip = null;
    }

    async function announce() {
      if (needsClip && !clip) {
        const opened = await startClip();   // throws: without the clip there is no A/V consent
        if (closed) { opened.discard(); return { spoken: false }; }
        clip = opened;
      }
      try {
        await speak(text, { clip, signal });
        return { spoken: true };
      } catch (e) {
        return { spoken: false, error: e.message };   // the host must read it aloud
      }
    }

    async function finish(agreed) {
      closed = true;
      if (!agreed) { discard(); return null; }
      const held = clip;
      clip = null;
      return held ? held.stop() : null;
    }

    return { announce, finish, discard, hasClip: () => !!clip };
  }

  const exported = { createConsentController, createAnnouncement };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.ConsentClient = exported;
})(typeof window !== 'undefined' ? window : globalThis);
