# Verbatimely: trademark screen before the visible rename

Task #22752, checked **2026-11-25** (2026-11-26 UTC). **Status: waiting for the owner. No paid search has been
commissioned and no money was spent.** This is a preliminary screen by an AI agent, not a clearance search or legal
advice.

**Result: Verbatimely does not pass ruling R5651.** The exact name was not found in the USPTO search, but a live
product called **Verbatimly** (one letter shorter) sells AI transcription. R5651 requires that no product of the name
exists in the same or a neighbouring market. Treating this one-letter difference as the same name is our judgment;
confusion in the legal sense is a lawyer's call.

## Owner action

> Choose one: **(A, recommended)** drop Verbatimely and pick another name; or **(B)** keep it under consideration and
> send the brief below to a trademark attorney, approving the quoted fee. Under either choice, keep the visible
> rename (#22547) on hold, and decide whether to take the name off the public verbatimely.com page now.

Why A: paying to clear a name with this conflict is likely to be wasted, and nothing visible in the app has to be
undone while #22547 waits. Screen any replacement with the command below before buying its domain.

The coming-soon page at <https://verbatimely.com/> already showed "Verbatimely" and described a meeting assistant on
the check date. R5651 allows a name in customer-visible text only after it is cleared. This task did not change the
page, which belongs to Verbatimely-Site.

## The conflict

| Site | What it served | Other facts |
| --- | --- | --- |
| <https://verbatimly.com/> | "Verbatimly": AI transcription and translation of audio and video, with summaries, speaker detection and Zoom, Meet and Teams connections for recordings | Domain registered 2025-06-30. [Impressum](https://verbatimly.com/en/impressum): Tech von Chu, Rheinbach, Germany. Footer ©2026 |
| <https://verbatimly.ai/> | "Verbatimly": video and audio to text, with paid file packs | [Terms](https://verbatimly.ai/terms) last updated 2026-11-11. Operator and first-use date not established |

Neither a domain date nor a page date proves when a product was first sold.

The Apple App Store (US) also lists these apps named "Verbatim" in neighbouring uses, as described by their listings:

- [Verbatim IQ: AI Voice to Text](https://apps.apple.com/us/app/verbatim-iq-ai-voice-to-text/id6758966677):
  meeting transcripts, summaries and action items without a bot
- [Verbatim: AI Note Taker](https://apps.apple.com/us/app/verbatim-ai-note-taker/id6760734456): records and
  transcribes meetings
- [Verbatim: Audio Transcription](https://apps.apple.com/us/app/verbatim-audio-transcription/id6837239404):
  on-device transcription, including meetings
- [Verbatim](https://apps.apple.com/us/app/verbatim/id6810913670): on-device dictation
- [Verbatim App](https://apps.apple.com/us/app/verbatim-app/id6776418623): dictation into documents

## USPTO register

Source: the search service behind <https://tmsearch.uspto.gov/>. The control query (live marks with the phrase
"verbatim") returned 16, so the service was returning results.

| Query | Records |
| --- | --- |
| Phrase "verbatimely", live and dead | 0 |
| Within two letter edits of "verbatimely", live and dead | 1: VERBATIMLY, TRUMP (88266078), abandoned, class 16 |
| Live word marks matching `verbat*` | 17, all returned |

Of the 17, an attorney should look at least at these (classes are those on the record):

| Mark | Serial | Class | Owner and subject |
| --- | --- | --- | --- |
| VERBATIM | 74504263 | 9 | Verbatim Corporation / Verbatim Americas: memory cards and recording media |
| V VERBATIM; VERBATIM; VERBATIM; VERBATIM GAMING XTREME | 77828513, 86431443, 86431490, 90028001 | 9 (some also 11) | Verbatim Americas |
| EVE - EVOLVED VERBATIM ENGINE | 97038415 | 42 | Evolved Insights: software service for AI conversations and feedback |
| VERBATIM STENO | 99442486 | 45 | Court reporting; pending |
| VERBATIM | 73671409 | 9 | RACO: automatic dialing remote monitors |
| VERBATIM | 86264357 | 41 | The New York Times Company: online videos and blogs |

The other eight are in classes 3, 11, 28, 33, 35 (two), 41 with 45, and 45; their goods were not reviewed.

## Domains

Checked through registry RDAP and by fetching the home page: verbatimely.com was registered at Cloudflare on
2026-11-25, matching the owner's note. This shows the registration, not the account that holds it. verbatimely.ai and
verbatimly.app did not resolve, which does not show that they are available.

## Not checked

- State registers, common-law use in general, and any register outside the US. The Verbatimly operator is in Germany,
  so the German and EU registers matter.
- Design-only marks, and sound-alike spellings outside the two queries above.
- Google Play and a general web search: automated search engine requests were refused or returned unrelated pages.

## Brief for the attorney (only for choice B)

> Please run a clearance search and give a written opinion on the word mark VERBATIMELY.
> Applicant: Bandera Pass Labs, a sole proprietorship. Market: United States first; say whether the EU and Germany
> should be added.
> Goods and services: downloadable software that transcribes meetings live, answers participants' questions, and
> produces task lists and documents with an AI assistant (we expect class 9; advise on class 42).
> Known concerns: verbatimly.com and verbatimly.ai offer AI transcription; several apps named Verbatim transcribe
> meetings; USPTO serials 74504263, 86431443, 86431490, 77828513, 90028001, 97038415 and 99442486.
> Please quote a fixed fee and turnaround before starting, and say whether the name can be used and registered.

## Run the screen again

```
node scripts/trademark-screen.js verbatimely --stem verbat --control verbatim verbatimly.com verbatimly.ai verbatimely.com
```

It prints the register records and each domain's page title as JSON. It stops with an error, not a zero result, if
the control mark returns nothing or a register answer is incomplete. An unreachable domain is listed as unknown. For
another name, change the name, stem, control mark (a word known to be a live mark) and domains. It does not search app
stores or the web; do that by hand.
