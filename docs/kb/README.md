# Meeteor help index

Product: **Meeteor**. Supported application runtime: **2.1.0** (`GET /version`). The current screens and installer use the name **Meetintel**. These files describe the features in this repository, not planned features.

This file is an index. It is not a knowledge article.

## Manuals

- [User manual](../user-manual/README.md)
- [Administrator guide](../admin-guide.md)

## Sulenna knowledge articles

### Getting started, account and license

- [How do I get started with Meeteor?](getting-started.md)
- [How do I create an account, sign in, or sign out?](sign-in.md)
- [How do I reset a forgotten password?](reset-password.md)
- [What are the free trial limits, and is my data deleted?](free-trial.md)
- [How do I buy and activate a license?](activate-license.md)
- [How do I set up and test the AI provider?](configure-ai.md)

### Main tasks

- [How do I start, save, and end a meeting?](record-meeting.md)
- [How do I choose the microphone and transcription settings?](audio-and-recording.md)
- [How do I manage insight cards?](use-cards.md)
- [How do I ask Meeteor a spoken question?](ask-a-question.md)
- [How do company research and suggestions work?](research-suggestions.md)
- [How do I show the Meeteor status orb to the room?](presenter-view.md)
- [How do I use the room camera, and what does it detect?](room-camera.md)
- [What do the market prices and headlines show?](market-strip.md)
- [How do I add or remove a document for context?](add-documents.md)
- [How do I create and export action items?](action-items.md)
- [How do I send action items to Microsoft To Do?](microsoft-to-do.md)
- [How do I record screen and audio in the desktop app?](record-av.md)
- [How do I review a past meeting?](history.md)
- [How do I generate a transcript from a recording?](generate-transcript.md)
- [How do I delete a past meeting?](delete-meeting.md)
- [What does Export CSV include?](export-csv.md)
- [How do I start and stop listening from a Stream Deck or MCP client?](remote-control.md)

### Troubleshooting

- [How do I fix an AI error card?](ai-errors.md)
- [Why are no insight cards appearing?](no-cards.md)
- [How do I fix "Microphone access denied"?](microphone-denied.md)
- [Why is no transcript appearing?](no-transcript.md)
- [Why did Meeteor not answer my spoken question?](no-spoken-answer.md)
- [Why did my document upload fail?](document-upload-fails.md)
- [Why is my license key rejected?](license-key-rejected.md)
- [Why does my new meeting contain the last meeting's text or to-dos?](old-text-in-new-meeting.md)
- [Why are my to-dos missing after reloading or in History?](todos-missing.md)
- [Why is remote start or stop refused or doing nothing?](remote-control-not-working.md)

### Privacy and limitations

- [Does my meeting data leave my computer?](data-privacy.md)
- [What are the known limitations of this version?](known-limitations.md)

## Load into Sulenna

1. Run `node docs/validate-help.js` and fix any failure. It checks front matter, article sections, this index, links, size limits for Sulenna ingestion, and obvious keys or email addresses. It does not check that the text matches the app.
2. In the Meeteor tenant, add each file under **Sulenna knowledge articles** as one article. Use its front matter `title` and `tags`, product **Meeteor**, version **2.1.0**, and keep the front matter with the content (it carries `applies_to`).
3. **Add the articles only.** Each manual is longer than the 16,000-character article limit recorded for Sulenna ingestion when these files were written. Keep the user manual as the maintainers' full reference. Do not load the administrator guide into a customer-facing tenant.
4. Do not load this index, or anything under `docs/decisions/`, `docs/market/` or `docs/feature-inventory.md`.
5. Ask a getting-started question, "Does my meeting data leave my computer?", and a known-limitation question. Confirm each answer comes from the right article.

No automated sync script exists in this repository. Loading and answer checks are separate release steps; they have **not** been run for these files.

## When to refresh

Refresh whenever a release changes a screen, button label, message, command, limit, data flow, limitation or the supported version.

1. Update the affected articles, the manuals and this index together. Update `version` in every article when the supported version changes, and the version in `docs/validate-help.js`.
2. Run the validator.
3. Update existing articles in the tenant instead of adding duplicates.
4. **Remove tenant articles whose file no longer exists.** `license-and-errors.md` has been replaced by several single-problem articles; if an earlier copy was loaded, remove it.
5. Repeat the answer checks.

The help files contain no credentials or customer records. Check any deployment-specific addition before loading it.
