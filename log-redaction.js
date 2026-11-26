'use strict';

const fs = require('node:fs');

// Lines earlier builds wrote with meeting text in them. Group 1 is the part that is safe to keep.
// [\s\S] rather than '.', because JSON.stringify leaves U+2028 unescaped and '.' stops there.
const TRANSCRIPT_LINES = [
  /^(\S+ Transcribe corrected:) [\s\S]*$/,
  /^(\S+ Transcribe: \d+ samples @ [\d.]+ Hz) → [\s\S]*$/,
  /^(\S+ Refine:) [\s\S]*$/,
  /^(\S+ proxy: Anthropic response \d+) [\s\S]+$/,
  // Node quotes the unparsable input, which can be a request body holding a transcript.
  /^(\S+ (?:UNHANDLED|UNCAUGHT) SyntaxError:)(?=[\s\S]*JSON)[\s\S]*$/,
];

function redactLine(line) {
  const pattern = TRANSCRIPT_LINES.find(candidate => candidate.test(line));
  return pattern ? line.replace(pattern, '$1 [redacted]') : line;
}

// Rewrites the log through a temporary file so a failure leaves the original intact.
// Safe to run on every start. Returns the number of lines changed.
function redactLogFile(logFile) {
  let content;
  try {
    content = fs.readFileSync(logFile, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
  let changed = 0;
  const lines = content.split('\n').map(line => {
    const redacted = redactLine(line);
    if (redacted !== line) changed++;
    return redacted;
  });
  if (!changed) return 0;
  const temp = logFile + '.tmp';
  try {
    fs.writeFileSync(temp, lines.join('\n'));
    fs.renameSync(temp, logFile);
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw e;
  }
  return changed;
}

module.exports = { redactLogFile };
