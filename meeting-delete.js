'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Deletes one meeting and everything stored for it. Nothing is touched unless the user owns it.
function createMeetingDeleter({ getDb, dbGet, saveDb, recordingsDir, log }) {
  return function deleteMeeting(meetingId, userId) {
    const notFound = { status: 404, body: { error: 'Not found' } };
    if (!Number.isInteger(meetingId)) return notFound;
    const meeting = dbGet('SELECT recording_path FROM meetings WHERE id=? AND user_id=?', [meetingId, userId]);
    if (!meeting) return notFound;

    // The file goes first: if it cannot be removed, the meeting stays so the user can see it and retry.
    if (meeting.recording_path) {
      try {
        fs.unlinkSync(path.join(recordingsDir, meeting.recording_path));
      } catch (e) {
        if (e.code !== 'ENOENT') {
          log('Recording delete failed for meeting', meetingId, e.code || e.message);
          return {
            status: 500,
            body: {
              error: 'recording_delete_failed',
              message: 'The recording file could not be deleted, so the meeting was not deleted. '
                + 'Close anything using the file and try again.',
            },
          };
        }
      }
    }

    const db = getDb();
    db.run('DELETE FROM cards WHERE meeting_id=?', [meetingId]);
    db.run('DELETE FROM intel_cache WHERE meeting_id=?', [meetingId]);
    db.run('DELETE FROM meetings WHERE id=? AND user_id=?', [meetingId, userId]);
    saveDb();
    return { status: 200, body: { ok: true } };
  };
}

module.exports = { createMeetingDeleter };
