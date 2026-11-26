# Consent step: two-party states and BIPA

Task #22754, written 2026-11-25. This is an engineering review of statute text against the code. **It is not legal
advice, and no lawyer has reviewed it.** No code, public page or price changed.

**Result: fail. The build has no consent step.** The charter requires that the AI announces itself and that capture
does not start without one. Nothing in the app asks, announces or records consent. Do not sell or demonstrate the
product as consent-compliant.

## Owner action

> Engage a licensed US privacy lawyer to answer the questions in [Questions for counsel](#questions-for-counsel) and
> approve the announcement and notice wording before the first sale or any use with people outside the company.

Recommendation: send this file as the brief. It needs the owner because it is a legal decision and may cost money.
Building the gate does not need to wait: use the strict rules in [Gate requirements](#gate-requirements) and
placeholder wording marked as unapproved.

## What the build captures

Read in the code on 2026-11-25; not run in a browser. `index.html` unless stated.

| Capture | How it starts | What is kept or sent |
| --- | --- | --- |
| Live listening | `toggleListen` opens the microphone at once. No meeting is needed | Audio goes to `/transcribe`; that handler does not save it. The transcript is saved if a meeting is active |
| Web Speech mode | `startWebSpeech` | The browser vendor's speech service receives the audio (the screen calls it cloud-based) |
| Record A/V (desktop) | `startRecord` starts a meeting if needed, then captures screen, system audio and microphone | `.webm` file on disk |
| Remote start | `/api/local/start-recording` in `server.js`; `initLocalControlChannel` then calls `startListen` | Starts listening with no on-screen confirmation |
| Room camera | `toggleRoomCamera`: one click, off at each start, shows a "Camera active" badge to whoever sees the screen | MediaPipe `FaceDetector` and `HandLandmarker` run on frames; the screen keeps a face count and a hand-raised flag |
| Server log | `/transcribe` in `server.js` calls `log` with the transcribed text | **Every transcribed chunk is appended to `meetintel.log`**, with or without a meeting |

The AI does not announce itself. It speaks only after the wake word or an approved suggestion, which is not notice
before capture. No code that creates voiceprints or identifies speakers was found: the "mine / theirs" label comes
from a manual talk button (`iAmTalking`).

## Recording and eavesdropping law

"All-party" below is shorthand. The statutes differ on which conversations they cover (usually private ones), on
whether notice is enough, and on exceptions. "Read" means the cited wording was read on the linked page on 2026-11-25;
it does not mean the whole statute or its case law was reviewed.

| Place | What the text read says | Source |
| --- | --- | --- |
| Federal (baseline) | A party, or someone with one party's prior consent, may intercept, with a crime or tort exception | [18 U.S.C. 2511(2)(d)](https://www.law.cornell.edu/uscode/text/18/2511) (Cornell copy), read |
| Washington | Consent of all participants. It counts as obtained when one party announces to all others, in a reasonably effective manner, that recording or transmission is about to happen; if recording, **the announcement must be recorded too** | [RCW 9.73.030](https://app.leg.wa.gov/RCW/default.aspx?cite=9.73.030), read |
| Illinois | Surreptitious recording or transmission of a private conversation needs the consent of all parties (all others, if you are a party). Using or disclosing unlawfully obtained content is also covered. Transcription is named for private electronic communications by non-parties | [720 ILCS 5/14-2](https://www.ilga.gov/Documents/legislation/ilcs/documents/072000050K14-2.htm), read |
| Florida | Interception is lawful when all parties have given prior consent | [Fla. Stat. 934.03(2)(d)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.03.html), read |
| Maryland | A party may intercept only where all parties have given prior consent | [Cts. & Jud. Proc. 10-402](https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcj&section=10-402&enactments=false), read |
| Massachusetts | Bars *secretly* hearing or recording without prior authority from all parties | [G.L. c. 272 § 99](https://malegislature.gov/Laws/GeneralLaws/PartIV/TitleI/Chapter272/Section99), read |
| Montana | Bars hidden-device recording without all parties' knowledge; a warning from one person is enough | [MCA 45-8-213](https://leg.mt.gov/bills/mca/title_0450/chapter_0080/part_0020/section_0130/0450-0080-0020-0130.html), read |
| New Hampshire | Intercepting without all parties' consent is an offence | [RSA 570-A:2](https://gc.nh.gov/rsa/html/LVIII/570-A/570-A-2.htm), read |
| Oregon | For conversations covered by (1)(c), all participants must be specifically informed; exceptions and the rules for calls were not reviewed | [ORS 165.540(1)(c)](https://www.oregonlegislature.gov/bills_laws/ors/ors165.html), read |
| California | **Not read.** The official page and a publisher copy returned a bot check. Treat as all-party | Penal Code 632 |
| Pennsylvania | **Not read.** The official page returned no statute text to the fetch. Treat as all-party | 18 Pa.C.S. 5703, 5704 |
| Connecticut, Delaware, Michigan, Nevada | **Not examined.** From background knowledge, their rules for some conversations or calls are mixed or disputed | Counsel |

All other states and all other countries were not examined.

Engineering conclusion: do not detect the state or let a setting weaken the gate. Participants can be anywhere, and
one rule (announce before capture, then record that everyone agreed) is simpler. Whether that satisfies every
jurisdiction is a question for counsel. A host ticking a box is the host's statement, not proof that anyone consented.

## BIPA and other biometric law

Illinois [BIPA 740 ILCS 14/10](https://www.ilga.gov/Documents/legislation/ilcs/documents/074000140K10.htm),
[14/15](https://www.ilga.gov/Documents/legislation/ilcs/documents/074000140K15.htm) and
[14/20](https://www.ilga.gov/Documents/legislation/ilcs/documents/074000140K20.htm), all read:

- A biometric identifier includes a **voiceprint** and a **scan of hand or face geometry**.
- Before collecting one, a private entity must inform the person in writing that it is collected, and of the purpose
  and length of term, and receive a written release (an electronic signature counts). A meeting-wide "everyone
  agreed" tick is not designed to meet this.
- A public written retention and destruction policy is required: destroy when the purpose ends or within 3 years of
  the last interaction, whichever is first. Selling or profiting is banned and disclosure is limited.
- Anyone aggrieved can sue: $1,000 (negligent) or $5,000 (intentional or reckless) liquidated damages, or actual
  damages if greater, plus fees. Repeat collection from one person by the same method counts as one violation of 15(b).

How it applies:

- **Voice:** keeping audio or text is not by itself shown here to create a voiceprint. The owner's notes report that
  BIPA claims against Otter survived dismissal (August 2026); the ruling was not read. Keep speaker identification
  out until it has per-person opt-in meeting the points above.
- **Room camera:** this is the open risk. The code comment says there is no face recognition, but the definition says
  "scan of hand or face geometry" and `HandLandmarker` locates points on hands. Whether an unsaved scan that
  identifies nobody is covered, and whether the vendor of local software "collects" it, were not resolved here.
  Keep the owner's feature; until counsel answers, it should stay off in builds that are sold or demonstrated.
- **Texas** ([Bus. & Com. Code 503.001](https://tcss.legis.texas.gov/resources/BC/htm/BC.503.htm), read): voiceprint
  and record of hand or face geometry; notice and consent before capture for a commercial purpose; destruction
  deadlines; civil penalty up to $25,000 per violation, brought by the attorney general. It has AI-related exceptions.
- **Washington** ([RCW 19.375.020](https://app.leg.wa.gov/RCW/default.aspx?cite=19.375.020), partly read) regulates
  enrolling biometric identifiers for a commercial purpose. Washington's My Health My Data Act, Colorado's biometric
  rules, other state privacy laws and the GDPR were not examined.

## EU AI Act, Article 50

Read on an [unofficial explorer](https://artificialintelligenceact.eu/article/50/), not EUR-Lex.

- 50(1): people interacting directly with an AI system must be informed it is AI, unless obvious. 50(5): clearly, no
  later than the first interaction or exposure. Article 50 applies from 2 August 2026
  ([Art. 113](https://artificialintelligenceact.eu/article/113/)). So this already applies where the Act reaches.
- 50(2) requires machine-readable marking of synthetic audio and text, subject to exceptions. This likely matters for
  the spoken voice and generated materials. The explorer shows an amendment giving systems placed on the market before
  2 August 2026 until 2 December 2026 for 50(2) only ([Art. 111](https://artificialintelligenceact.eu/article/111/)).
  This review did not establish whether this build was placed on the EU market by then; do not rely on the later date.
- 50(3) adds duties for emotion recognition and biometric categorisation. The current camera outputs are neither a
  stated emotion nor a category; keep it that way.

## Gate requirements

Engineering defaults for the implementation, pending counsel.

1. No microphone, screen, camera or speech service opens until consent is recorded for the current meeting session.
   This covers `toggleListen`, `startRecord`, `toggleRoomCamera`, Web Speech and the remote start event. Enforce it
   in `server.js` too: `/transcribe` and `/recording/upload` reject a meeting without a consent record.
2. Remote start never gives consent. Without a record it opens the prompt and captures nothing.
3. Before capture, the AI announces on screen and aloud that it is an AI, what it captures, and whether audio, video
   or text is kept or sent to a cloud provider. If speech fails, the host must read it aloud. The host then confirms
   that everyone present heard it and agreed. Declining or closing leaves capture off.
4. If A/V recording is on, the announcement and answer are also in the recording (Washington). This needs a narrow
   announcement step that captures only that exchange and discards it if consent is declined; counsel must approve it.
5. A late arrival gets the announcement again and must agree before capture continues. A refusal or withdrawal stops
   all capture with one control. Starting a new mode or sending data somewhere new (including switching from a local
   to a cloud backend) asks again.
6. Save per meeting: time, wording version, announced modes and destination, who confirmed, and any withdrawal.
   Consent never carries into another meeting or is a "do not ask again" preference.
7. A visible capture indicator stays on while anything is captured.
8. No speaker identification or voiceprints. Camera stays off in sold builds until counsel answers.

## Related gaps

Found while reading; separate from the gate.

- Meeting text reaches `meetintel.log`, and deleting a meeting does not remove it.
- `DELETE /meeting/` does not delete the meeting's `intel_cache` rows, ignores a failed recording-file deletion and
  reports success. Its card deletion is not limited to the signed-in user, so a user could delete another user's cards
  by meeting id in the multi-user web app.
- No retention period for meeting data was found, apart from expired-trial cleanup.
- Remote start trusts any loopback connection without a login. If the hosted app sits behind a proxy on the same host,
  outside requests could look local. The deployment was not inspected.

## Questions for counsel

Facts: software sold one-time, run on the customer's machine or room device (a hosted web mode also exists in the
code). Transcription is local; text may go to a cloud AI provider in the current build. No voiceprints. Optional
camera as above.

1. Which rule should apply when participants are in several states or countries, or on a call? Confirm California,
   Pennsylvania, Connecticut, Delaware, Michigan, Nevada and any other state, including whether live transcription
   with no saved audio is covered.
2. Is an announcement plus the host's confirmation enough, or must each participant act? Approve the wording,
   including for late arrivals and remote participants.
3. Does the room camera's face detection or hand landmarking fall under BIPA or Texas 503.001 when nothing is saved
   and nobody is identified? What notice, release and public policy would it need?
4. Does processing voice for transcription alone create BIPA exposure?
5. What is the vendor's exposure for software the customer operates, and does the answer change for the hosted mode
   or when a cloud AI provider receives text? (The owner's notes say Granola was sued although botless.)
6. What terms, privacy notice, retention schedule and customer obligations must ship with the product?
7. Do two-party or privacy laws limit the AI's web lookups and project memory across meetings?
8. If sold into the EU: what do Article 50 and the GDPR require, and when?

## How to check

- No gate: search `index.html` and `server.js` for `consent`. The only matches are two `index.html` comments about
  the camera badge. Then read `toggleListen`, `startRecord` and `toggleRoomCamera`.
- Transcript in the log: search `server.js` for `log('Transcribe`, then read `log` (it appends to `LOG_FILE`).
- Law: open the linked pages. Rows marked not read or not examined are unverified.
