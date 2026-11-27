# Meeteor help index

Product: **Meeteor**. Supported application runtime: **2.1.0** (`GET /version`). Some of its current screens and its installer show the label `Meetintel`; the help files quote that label only where a reader needs to match it. These files describe the features in this repository, not planned features.

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
- [How does the consent step work before capture?](meeting-consent.md)
- [How do I choose the microphone and transcription settings?](audio-and-recording.md)
- [How do I manage insight cards?](use-cards.md)
- [How do I ask Meeteor a spoken question?](ask-a-question.md)
- [How do I mute Meeteor's spoken voice?](mute-voice.md)
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

**Which files to add:** every file linked under [Sulenna knowledge articles](#sulenna-knowledge-articles), one article per file. **Do not add** the user manual, the administrator guide, this index, anything under `docs/decisions/` or `docs/market/`, or `docs/feature-inventory.md`. Both manuals are longer than Sulenna's 16,000-character article limit. The articles carry the customer help; the manuals are the full references, and the administrator guide is not for a customer-facing tenant.

1. In the repository folder, run `node docs/validate-help.js` and fix any failure. It checks front matter, article sections, this index, links, Sulenna title, size and tag-length limits, use of the product name, and obvious keys or email addresses. It does not check that the text matches the app.
2. Sign in to the Sulenna admin workspace, select the Meeteor tenant, and open **Knowledge**.
3. Under **Add an article**, fill in the form from one file:

   | Form field | Value |
   | --- | --- |
   | **Title** | The front matter `title` |
   | **Product (blank = all)** | `Meeteor` |
   | **Version (blank = all)** | `2.1.0` |
   | **Instructions** | The whole file, including the front matter (it carries `applies_to`) |
   | **Official source URL (optional)** | Leave blank |
   | **Tags (comma-separated, up to 10)** | The front matter `tags`, without the square brackets |

4. Review the content, keep **I have reviewed this content for publication** selected, and select **Save article**.
5. Repeat steps 3 and 4 for every article. Check that **Knowledge library** shows each title once, marked **Published**.
6. In a support chat for the tenant, with product `Meeteor` and version `2.1.0`, ask "How do I get started with Meeteor?", "Does my meeting data leave my computer?" and "What are the known limitations of this version?" Confirm that the cited sources are `getting-started.md`, `data-privacy.md` and `known-limitations.md`, matched by title.

No automated sync script exists in this repository. Loading and answer checks are separate release steps; they have **not** been run for these files. The screen and field names above were read from the Sulenna source code, not tried on a running installation.

## When to refresh

Refresh whenever a release changes a screen, button label, message, command, limit, data flow, limitation or the supported version.

1. Update the affected articles, the manuals and this index together. When the supported version changes, also update `version` in every article, the version in `docs/validate-help.js`, and the version in the loading steps above.
2. Run the validator.
3. Add new files as described above.
4. For a changed file, update the existing tenant article. The **Knowledge** page cannot edit or delete an article. A Sulenna administrator can update one in place through the admin API: find its `id` in `GET /api/admin/workspace`, then send the complete article with that same `id` to `POST /api/admin/articles` (`id`, `tenantId`, `title`, `product`, `version`, `body`, `sourceUrl`, `published`, `tags`, `sku`). Keep the existing `sku` value. An empty `id` creates a duplicate. Without API access, select **Unpublish** on the old article, then add the new text as a new article.
5. If a file no longer exists, select **Unpublish** on its tenant article. Unpublished articles are not used in answers. `license-and-errors.md` has been replaced by several single-problem articles; if an earlier copy was loaded, unpublish it.
6. Repeat the answer checks.

The help files contain no credentials or customer records. Check any deployment-specific addition before loading it.
