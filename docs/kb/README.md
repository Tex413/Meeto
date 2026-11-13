# Meeteor help index

Product: **Meeteor**. Supported application runtime: **2.1.0**. The current interface and installer also use **Meetintel**. These files describe the features in this repository, not planned features in the product charter.

## Manuals

- [User manual](../user-manual/README.md)
- [Administrator guide](../admin-guide.md)

## Sulenna knowledge articles

- [Get started with Meeteor](getting-started.md)
- [Record and transcribe a meeting](record-meeting.md)
- [Choose audio and recording controls](audio-and-recording.md)
- [Use insight cards and room controls](use-cards.md)
- [Add documents for context](add-documents.md)
- [Create and export action items](action-items.md)
- [Find or delete meeting history](history.md)
- [Resolve trial, AI, and microphone errors](license-and-errors.md)
- [Known limitations](known-limitations.md)

## Load and refresh in Sulenna

Add each article listed under **Sulenna knowledge articles** as a separate knowledge file in the Meeteor tenant. Keep its front matter with the content. Add the two manuals if the tenant supports longer reference documents; this index is for maintainers and should not be loaded as an answer article. Select product **Meeteor** and version **2.1.0** when the ingestion workflow asks for them. After ingestion, verify that a getting-started question and a known-limitation question retrieve the right article. Refresh the tenant's knowledge whenever a release changes a screen, command, limitation, or supported runtime; update article versions and this index together. Knowledge ingestion and answer verification are operational release steps and have not been run by this documentation change.

The articles and manuals contain no customer records, credentials, or secret values. Review any deployment-specific additions before loading them.
