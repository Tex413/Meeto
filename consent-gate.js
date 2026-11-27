'use strict';

// Meeting consent gate: the server side of "Gate requirements" 1-8 in
// docs/decisions/consent-legal-review.md. Strict all-party rule everywhere: there is no
// location detection and no setting that weakens it. A record is the host's statement that
// everyone agreed, not proof that they did.

const crypto = require('node:crypto');

// The wording below is an engineering placeholder. Counsel has not approved it (nor the
// announcement clip for A/V recording). Change the version whenever the text changes.
const WORDING_VERSION = 'unapproved-draft-1';
const WORDING_APPROVED = false;

const MODES = ['microphone', 'webspeech', 'recording', 'camera'];
const CLOSE_REASONS = new Set(['declined', 'withdrawn', 'late_arrival', 'destination_changed']);
const ANNOUNCERS = new Set(['speech', 'host']);
const AI_NAMES = { openai: 'OpenAI', anthropic: 'Anthropic' };
const MAX_CONFIRMER = 120;

function httpError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

// Where meeting data goes with these settings. Mirrors the key routing in /proxy: an
// Anthropic key parked in the OpenAI slot is sent to Anthropic.
function destinationFor({ settings, desktop }) {
  const s = settings || {};
  let ai = 'none';
  if (s.ai_provider === 'anthropic') {
    if (s.anthropic_key) ai = 'anthropic';
  } else if (s.openai_key) {
    ai = s.openai_key.startsWith('sk-ant-') ? 'anthropic' : 'openai';
  }
  const server = desktop ? 'this-computer' : 'app-server';
  const microsoft = !!s.msft_tokens;
  return { server, ai, microsoft, key: `${server}|${ai}|${microsoft ? 'microsoft' : 'no-microsoft'}` };
}

function buildAnnouncement(modes, destination) {
  const here = destination.server === 'this-computer'
    ? 'this computer'
    : 'the app server that serves this page';
  const lines = [
    'Before we start: an AI assistant is part of this meeting. It is an AI, not a person.',
  ];
  if (modes.includes('microphone')) {
    lines.push(`It will listen through the microphone and turn speech into text on ${here}. `
      + 'This transcription does not save the audio. The text is saved with the meeting.');
  }
  if (modes.includes('webspeech')) {
    lines.push('It will listen through the microphone, and the audio is sent to the cloud speech service of the '
      + 'browser maker. The text is saved with the meeting.');
  }
  if (modes.includes('recording')) {
    lines.push('It will record video and audio: the screen, the computer sound and the microphone. '
      + `The recording, including this announcement and your answer, is saved on ${here}.`);
  }
  if (modes.includes('camera')) {
    lines.push('A camera will watch the room to count faces and notice raised hands on this device. '
      + 'Camera images are not saved or sent.');
  }
  lines.push(destination.ai === 'none'
    ? 'No cloud AI provider is set up to receive the meeting text.'
    : `Meeting text is sent to ${AI_NAMES[destination.ai]}, a cloud AI provider, which may also use it `
      + 'to search the web.');
  if (destination.microsoft) lines.push('Action items may be sent to Microsoft To Do, a Microsoft cloud service.');
  lines.push('Everyone present must agree before capture starts. If you do not agree now, or change your mind '
    + 'later, say so and all capture will stop.');
  return lines.join(' ');
}

function normalizeModes(modes, { cameraEnabled }) {
  if (!Array.isArray(modes) || !modes.length) throw httpError(400, 'modes are required');
  if (modes.some(mode => !MODES.includes(mode))) throw httpError(400, 'unknown capture mode');
  if (!cameraEnabled && modes.includes('camera')) {
    throw httpError(403, 'The room camera is turned off in this build.', 'camera_disabled');
  }
  return MODES.filter(mode => modes.includes(mode));
}

function createConsentStore({ getDb, save, now = () => new Date().toISOString(), newId = () => crypto.randomUUID() }) {
  function all(sql, params = []) {
    const stmt = getDb().prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally { stmt.free(); }
  }

  function write(sql, params) {
    getDb().run(sql, params);
    save();
  }

  function migrate() {
    getDb().run(`CREATE TABLE IF NOT EXISTS consent_records (
      id TEXT PRIMARY KEY,
      meeting_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      granted_at TEXT NOT NULL,
      wording_version TEXT NOT NULL,
      wording_approved INTEGER NOT NULL,
      announcement TEXT NOT NULL,
      modes TEXT NOT NULL,
      destination TEXT NOT NULL,
      destination_key TEXT NOT NULL,
      confirmer TEXT NOT NULL,
      announced_by TEXT NOT NULL,
      announcement_recorded INTEGER NOT NULL,
      closed_at TEXT,
      close_reason TEXT,
      recording_path TEXT,
      recorded_at TEXT
    )`);
  }

  function parse(row) {
    return { ...row, modes: JSON.parse(row.modes), destination: JSON.parse(row.destination) };
  }

  function list(meetingId, userId) {
    return all('SELECT * FROM consent_records WHERE meeting_id = ? AND user_id = ? ORDER BY rowid',
      [meetingId, userId]).map(parse);
  }

  function find(meetingId, userId, consentId) {
    return list(meetingId, userId).find(record => record.id === consentId) || null;
  }

  // Ends every open record of a meeting. This is where a withdrawal is saved.
  function close(meetingId, userId, reason) {
    write('UPDATE consent_records SET closed_at = ?, close_reason = ? '
      + 'WHERE meeting_id = ? AND user_id = ? AND closed_at IS NULL', [now(), reason, meetingId, userId]);
  }

  function grant({ meetingId, userId, modes, destination, confirmer, announcedBy, announcementRecorded }) {
    close(meetingId, userId, 'superseded');
    const id = newId();
    write('INSERT INTO consent_records (id, meeting_id, user_id, granted_at, wording_version, wording_approved, '
      + 'announcement, modes, destination, destination_key, confirmer, announced_by, announcement_recorded) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, meetingId, userId, now(), WORDING_VERSION, WORDING_APPROVED ? 1 : 0,
      buildAnnouncement(modes, destination), JSON.stringify(modes), JSON.stringify(destination), destination.key,
      confirmer, announcedBy, announcementRecorded ? 1 : 0]);
    return find(meetingId, userId, id);
  }

  // Why live capture data may not be accepted, or null when it may.
  function liveRefusal({ meetingId, userId, consentId, mode, destinationKey }) {
    const record = consentId ? find(meetingId, userId, consentId) : null;
    if (!record) return 'No consent record for this meeting session.';
    if (record.closed_at) return 'Consent for this meeting session has ended or was withdrawn.';
    if (!record.modes.includes(mode)) return 'Consent does not cover this capture mode.';
    if (record.destination_key !== destinationKey) return 'Meeting data would now go somewhere new. Ask again.';
    return null;
  }

  // Why /transcribe must reject, or null. source 'recording' re-reads a saved recording that
  // was itself made under consent; everything else is live capture. inFlight tolerates a
  // record replaced by a wider one while its audio was being transcribed.
  function transcriptionRefusal({ meetingId, userId, consentId, source, destinationKey, inFlight = false }) {
    if (source === 'recording') {
      return recordings(meetingId, userId).length ? null : 'This meeting has no recording made with consent.';
    }
    if (source !== 'live') return 'Unknown audio source.';
    if (inFlight) {
      const record = find(meetingId, userId, consentId);
      if (record && record.close_reason === 'superseded') return null;
    }
    return liveRefusal({ meetingId, userId, consentId, mode: 'microphone', destinationKey });
  }

  // A recording may be uploaded after consent ended (End and Withdraw both stop the recorder
  // first), but only once, and only against the record it was announced and made under.
  function uploadable(meetingId, userId, consentId) {
    const record = consentId ? find(meetingId, userId, consentId) : null;
    if (!record || !record.modes.includes('recording') || !record.announcement_recorded) return null;
    return record.recording_path ? null : record;
  }

  function saveRecording(consentId, filename) {
    write('UPDATE consent_records SET recording_path = ?, recorded_at = ? WHERE id = ?',
      [filename, now(), consentId]);
  }

  function recordings(meetingId, userId) {
    return list(meetingId, userId).filter(record => record.recording_path);
  }

  function remove(meetingId, userId) {
    write('DELETE FROM consent_records WHERE meeting_id = ? AND user_id = ?', [meetingId, userId]);
  }

  return {
    migrate, list, find, close, grant, transcriptionRefusal, uploadable, saveRecording, recordings, remove,
  };
}

// Handles /consent/preview, /consent/grant and /consent/withdraw. Returns true when handled.
function createConsentRouter({ store, sendJson, readBody, ownsMeeting, getDestination, cameraEnabled }) {
  function meetingIdFor(value, userId) {
    const meetingId = Number(value);
    if (!Number.isInteger(meetingId) || meetingId < 1) throw httpError(400, 'meetingId is required');
    if (!ownsMeeting(meetingId, userId)) throw httpError(404, 'meeting not found');
    return meetingId;
  }

  async function jsonBody(req) {
    // A JSON content type forces a CORS preflight, so another web page cannot forge a record.
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      throw httpError(415, 'Content-Type must be application/json');
    }
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw); } catch (_) { throw httpError(400, 'invalid JSON'); }
    if (!body || typeof body !== 'object') throw httpError(400, 'invalid JSON');
    return body;
  }

  function preview(req, userId) {
    const query = new URL(req.url, 'http://x').searchParams;
    meetingIdFor(query.get('meetingId'), userId);
    const modes = normalizeModes((query.get('modes') || '').split(',').filter(Boolean), { cameraEnabled });
    const destination = getDestination(userId);
    return {
      wordingVersion: WORDING_VERSION,
      wordingApproved: WORDING_APPROVED,
      modes,
      destination,
      announcement: buildAnnouncement(modes, destination),
    };
  }

  async function grant(req, userId) {
    const body = await jsonBody(req);
    const meetingId = meetingIdFor(body.meetingId, userId);
    const modes = normalizeModes(body.modes, { cameraEnabled });
    const confirmer = typeof body.confirmer === 'string' ? body.confirmer.trim() : '';
    if (!confirmer || confirmer.length > MAX_CONFIRMER) {
      throw httpError(400, `Name of the person confirming is required (up to ${MAX_CONFIRMER} characters).`);
    }
    if (body.everyoneAgreed !== true) throw httpError(400, 'Everyone present must have heard it and agreed.');
    if (!ANNOUNCERS.has(body.announcedBy)) throw httpError(400, 'The announcement must be spoken or read aloud.');
    if (modes.includes('recording') && body.announcementRecorded !== true) {
      throw httpError(400, 'A/V recording needs the announcement and answer in the recording.');
    }
    const destination = getDestination(userId);
    if (body.wordingVersion !== WORDING_VERSION || body.destinationKey !== destination.key) {
      throw httpError(409, 'The announcement is out of date. Announce again.', 'announcement_changed');
    }
    const record = store.grant({
      meetingId, userId, modes, destination, confirmer,
      announcedBy: body.announcedBy, announcementRecorded: body.announcementRecorded === true,
    });
    return { consentId: record.id, meetingId, modes: record.modes, destinationKey: record.destination_key };
  }

  async function withdraw(req, userId) {
    const body = await jsonBody(req);
    const meetingId = meetingIdFor(body.meetingId, userId);
    if (!CLOSE_REASONS.has(body.reason)) throw httpError(400, 'unknown reason');
    store.close(meetingId, userId, body.reason);
    return { ok: true };
  }

  const routes = {
    'GET /consent/preview': preview,
    'POST /consent/grant': grant,
    'POST /consent/withdraw': withdraw,
  };

  return async function handleConsent(req, res, userId) {
    const route = routes[`${req.method} ${req.url.split('?')[0]}`];
    if (!route) return false;
    try {
      sendJson(res, 200, await route(req, userId));
    } catch (e) {
      if (!e.statusCode) throw e;
      sendJson(res, e.statusCode, { error: e.code || 'consent_error', message: e.message });
    }
    return true;
  };
}

// The camera stays off in sold builds until counsel answers (requirement 8). It can only be
// turned on for development: never in a packaged desktop app or a production server.
function roomCameraEnabled({ env, desktop, desktopDev }) {
  return env.ROOM_CAMERA_DEV === '1' && env.NODE_ENV !== 'production' && (!desktop || desktopDev);
}

module.exports = {
  WORDING_VERSION,
  WORDING_APPROVED,
  MODES,
  destinationFor,
  buildAnnouncement,
  createConsentStore,
  createConsentRouter,
  roomCameraEnabled,
};
