# Meeteor user manual

Product: **Meeteor**. Supported runtime: **2.1.0**. The screens, installer, license keys and some messages say **Meetintel**; this manual quotes on-screen text exactly. It describes the application as built. Features that are planned but not built are listed under [Known limitations](#known-limitations).

Contents:

- [Before you start](#before-you-start)
- [Create an account, sign in, and sign out](#create-an-account-sign-in-and-sign-out)
- [Trial and license](#trial-and-license)
- [Set up the AI provider](#set-up-the-ai-provider)
- [Find your way around the main screen](#find-your-way-around-the-main-screen)
- [Set up transcription and audio](#set-up-transcription-and-audio)
- [Run a meeting](#run-a-meeting)
- [Use insight cards](#use-insight-cards)
- [Ask a spoken question](#ask-a-spoken-question)
- [Company research and suggestions](#company-research-and-suggestions)
- [Show the presence orb to the room](#show-the-presence-orb-to-the-room)
- [Use the room camera](#use-the-room-camera)
- [Follow the market strip](#follow-the-market-strip)
- [Add documents for context](#add-documents-for-context)
- [Manage action items](#manage-action-items)
- [Send action items to Microsoft To Do](#send-action-items-to-microsoft-to-do)
- [Record screen and audio (desktop app)](#record-screen-and-audio-desktop-app)
- [Review past meetings](#review-past-meetings)
- [Delete a meeting](#delete-a-meeting)
- [Export cards to CSV](#export-cards-to-csv)
- [Clear the live screen](#clear-the-live-screen)
- [Start and stop listening from another program](#start-and-stop-listening-from-another-program)
- [Troubleshooting](#troubleshooting)
- [What leaves your computer](#what-leaves-your-computer)
- [Known limitations](#known-limitations)

## Before you start

- **Get consent yourself.** The app does not announce itself and has no consent step. Before you select **Start listening** or **Record A/V**, or turn on the room camera, tell every participant that an AI is present and get the consent your meeting requires.
- **This build uses cloud AI.** Cards, spoken answers, action-item extraction and transcript cleanup use OpenAI or Anthropic. **AI transcript cleanup** is on by default. Read [What leaves your computer](#what-leaves-your-computer) before a confidential meeting.
- **Check what the app tells you.** Cards and answers do not reliably name their sources. Verify important facts yourself.

There are two ways to run the app. The **web app** runs in a browser against a server and uses accounts and a free trial. The **desktop app** runs on your own computer as a single local user.

## Create an account, sign in, and sign out

These steps apply to the web app. The desktop app has no sign-in screen.

### Create an account

1. Open the address your administrator gave you. A local server on the default port is at `http://localhost:7432`.
2. Select the **Create account** tab.
3. Enter your email, a password of at least 6 characters, and the password again.
4. Select **Create account & start trial**. You are signed in.

### Sign in

1. On the **Sign in** tab, enter your email and password.
2. Select **Sign in**.

A sign-in lasts no more than 8 hours in the browser, and a server restart signs everyone out. If the app stops saving or loading, reload the page and sign in again.

### Reset a forgotten password

1. On the sign-in screen, select **Forgot password?**
2. Enter your email and select **Send reset link**. The same confirmation appears whether or not the email is registered.
3. Open the link in the email within 1 hour.
4. Under **Set a new password**, enter at least 6 characters twice and select **Set new password**.

If no email arrives, ask your administrator. A server without mail settings does not send email; the administrator can give you the link another way.

### Sign out

1. Select **Sign out** (the lock icon) on the toolbar.

## Trial and license

### Free trial (web app)

- The trial allows **20 minutes of audio sent for Whisper transcription**, including **Generate transcript**, and **2 document uploads**. Removing a document does not give an upload back.
- The toolbar badge shows the time left, for example **12 min trial left**, or **Trial expired**.
- When the trial time is used up, you cannot start a new meeting record, transcribe with Whisper, or upload documents.
- **Warning: trial data is deleted.** About 7 days after your trial time runs out, if the account is still on the trial, the server deletes its meetings, cards and documents. This cannot be undone from the app. Copy anything you need, or activate a license, before then.

### Activate a license in the web app

1. Select the trial badge on the toolbar. A dialog headed **Your free trial has ended** opens. It has that heading even if you still have time left.
2. Under **Already have a license key?**, paste your key.
3. Select **Activate**. The trial badge disappears.

### Activate the desktop app

1. Start the desktop app. A packaged build without a valid license shows **Activate Meetintel**.
2. Paste your key into **License key**.
3. Select **Activate**, or press Ctrl+Enter. The key is checked on your computer, and the main screen loads.

### Buy a license

1. In the trial dialog, select **See pricing**. You can also open `/landing` on your server and go to **Pricing**.
2. Select **Get annual plan** or **Get lifetime license** and complete checkout. If checkout is not set up on that server, a message says so and nothing is charged.
3. On the **Payment confirmed!** page, select **Copy key** and store the key somewhere safe. The app does not email the key.
4. Activate it as described above.

The success page says the key will not be shown again, and its instructions mention **Settings → License**. There is no License section in Settings: use the trial dialog or the desktop activation screen. The activation screen mentions a "purchase email", but the app does not send one. If the page shows **Key unavailable**, contact your administrator or support with your payment receipt.

Do not include a license key in a support message.

## Set up the AI provider

You need an OpenAI or Anthropic API key for the AI features. Whisper transcription does not need one.

1. Select **Settings** (gear). On first use, when no key is saved, Settings opens by itself and a card says **Add an API key to get started**.
2. Choose **AI Provider**: **OpenAI** or **Anthropic (Claude)**.
3. Choose a **Model**. OpenAI offers **GPT-4o (recommended)**, **GPT-4o mini (fast & cheap)**, **GPT-4 Turbo** and **o1-mini (reasoning)**. Anthropic offers **Claude Opus 4.7 (most powerful)**, **Claude Sonnet 4.6 (balanced)** and **Claude Haiku 4.5 (fast)**.
4. Paste the key into **OpenAI API Key** or **Anthropic API Key**, matching the provider.
5. Optionally set **Wake word**, **Injection mode** and **EIA.gov API Key** (see the later sections).
6. Select **Save**.
7. Open Settings again and look for **✓ Key saved** under the key field. The field itself is always blank.

Provider, model and keys are saved on the server for your account. Wake word and injection mode are saved in the browser you are using. Transcript cleanup uses a smaller model chosen by the app (Claude Haiku 4.5 or GPT-4o mini), not your selection.

### Test the connection

1. Select **Debug log** (bug icon) to open the log.
2. Select **Test AI**.
3. Look for **AI test passed** in the log. Success is reported only there. On failure the log says **AI test FAILED**, and an error card normally appears in **Insight cards**.

## Find your way around the main screen

The toolbar has, from left to right: **Session title**, **Record** (or **End**), the build number, status, microphone level, microphone menu, **Start listening**, **Record A/V** (desktop only), the trial badge, **Export action items**, **History**, **Export CSV**, **Clear all**, **Test AI**, **Debug log**, **Enable room camera**, **Settings**, **Sign out**, the presence orb with the wake-word badge, and a BKV stock badge. Icon buttons show their names when you point at them.

Below are the market strip and the transcription controls. The left side holds **Live transcript**, **To-dos**, **Context** and **Documents**; the right side holds **Insight cards**. Drag the divider between them to resize the left side. Select the **To-dos** or **Documents** heading to collapse or expand it.

**Debug log** has **copy**, **clear** and **hide** buttons and keeps the latest 50 lines. It can include transcript text and answers, so review it before you share it.

## Set up transcription and audio

1. Next to **STT**, choose **Whisper** or **Web Speech**.
   - **Whisper** is selected each time the page loads. Audio goes to the app's own server for transcription: your computer in the desktop app, or the hosting server in the web app. No API key is needed. The first use can be slow while the model downloads.
   - **Web Speech** is marked **Chrome only** and does not work in the desktop app. It uses the browser vendor's cloud speech service.
2. Choose your microphone from the microphone menu. Device names may appear only after you allow microphone access.
3. Set **Echo**, **Denoise** and **AGC**. All are on by default. If you change one while listening, the status shows **Restart to apply**: select **Stop**, then **Start listening**.
4. Set **Boost** (1 to 30, default 10) if speech is missed. It applies immediately. The tooltip suggests turning off **AGC** if you use manual Boost.
5. Set **Chunk** (3, 4, 6 or 8 seconds, default 4), the longest piece of audio Whisper receives at once. It usually sends sooner, at a pause.

Names and terms in **Context** also help: Whisper output is corrected toward words found there. The correction can change an ordinary word into a similar one from Context, so check the transcript.

### Who the cards are for

Next to **Mode**:

- **Everyone** (default): cards are based on the whole transcript.
- **Others only**: shows the hint **Hold Space = your voice (ignored for cards)**. In this build, holding Space only marks your lines differently in the transcript. **Your words are still used for cards.**
- **Fact-check me**: asks the AI to flag inaccurate or incomplete statements with **fact check** cards. It receives the recent transcript from all speakers, not only the parts spoken while you held Space.

Holding Space has no effect while the cursor is in a text box. The app does not identify speakers.

## Run a meeting

**Record** and **Start listening** do different things. **Record** creates the saved meeting. **Start listening** opens the microphone. Use both. If you listen without **Record**, the transcript and cards are not saved.

1. Tell participants and get their consent.
2. If the screen still shows an earlier meeting, select **Clear all** now, **before** you select **Record**. Otherwise the earlier transcript and to-dos can be saved into the new meeting. **Clear all** does not ask for confirmation.
3. Enter a **Session title**. If you leave it blank, the app uses the date and time.
4. Optionally type or paste notes into **Context**. The app keeps this text in your browser for later visits, so remove anything you do not want kept or sent to the AI.
5. Select **Record**. The badge shows the title.
6. Select **Start listening** and allow microphone access. Text appears in **Live transcript**, with a word count.
7. To pause or silence the microphone, select **Stop**. Select **Start listening** to resume.
8. To finish, select **Stop** first and wait a few seconds for the last words to appear. Then select **End**. The badge shows **Saved**. **End** also stops listening and any A/V recording.

While a meeting is active, the transcript is saved about every 15 seconds. **Do not select Clear all during an active meeting:** the next automatic save replaces the saved transcript with the cleared one.

### AI transcript cleanup

The **AI transcript cleanup** box under **Context** is on by default. It sends transcript text, and the start of Context, to your AI provider to fix misheard words. The cleaned text appears **on screen only**. The saved transcript, and the text used for cards, are not replaced. Clear the box to stop these requests.

## Use insight cards

1. Start listening. The countdown shows **Analysis in … s**.
2. At each interval, the app sends the recent transcript to your AI provider if there are at least 12 new words. Cards appear in **Insight cards**. No card is created when the AI finds nothing worth showing.
3. Set **Interval** (10 to 120 seconds, default 20) to change how often this happens.
4. Set **Terseness**: **terse**, **balanced** (default) or **detailed**.
5. A new insight on an existing topic may be added to the existing card instead of making another.
6. To keep a card at the top, select its **Pin** button. Select it again to unpin.
7. To remove a card, select its **Delete** button. It disappears from the live list and from History. It can still appear in the CSV export.
8. To search the live list, type in **Filter cards…**. Select the clear button to show all cards again.
9. To tidy the live list, choose **Auto-clear**: **Off**, **5m**, **10m**, **15m**, **30m** or **60m**. Unpinned cards older than that fade from the live list. They stay in History.

A card tagged as an action item also adds its title to **To-dos**.

The amount shown as **$… est.** in the controls bar is a rough figure from card analysis only, calculated at one fixed rate whatever model you use. It is not your bill. Check your provider's account for actual charges.

## Ask a spoken question

You ask by voice. There is no box for typing questions.

1. In **Settings**, set the **Wake word** (default **Craig**) and select **Save**. The badge beside the orb shows **Say "…"** and the injection mode. Select the badge to open Settings. An ordinary first name tends to be recognised better than a made-up word.
2. Get consent, select **Record** if you want the answer saved, then **Start listening**.
3. In one sentence, without a long pause, say the wake word followed by your question.
4. Wait. The app sends the question, with Context, matching document excerpts and market figures, to your AI provider. It speaks a short answer and adds a **board member** card with it.
5. Before asking another question, pause for at least 8 seconds. A second question run into the same stretch of speech can be ignored.

Speaking needs voice files that your browser downloads from the internet the first time. With **Whisper**, the app ignores audio captured while it is speaking. **There is no mute button for the spoken voice:** **Stop** stops the microphone, not an answer already playing. Use your computer's volume or mute control to silence it at once. If no answer comes, open **Debug log**.

The wake word is matched as text anywhere in the speech, so saying it in ordinary conversation can trigger an answer to the words that follow.

## Company research and suggestions

With **Anthropic (Claude)** as provider, during a meeting you are listening to, the app picks out company names from the recent transcript and runs web searches about them. It does this in both injection modes. It does not happen with OpenAI.

1. In **Settings**, choose **Injection mode** and select **Save**:
   - **Ask-only** (default): research is kept quietly and can be used when you ask a question.
   - **Suggest & approve**: when research is ready, a banner says that your wake-word name "wants to mention" it.
2. Select **Speak** to hear the summary and add it as a card.
3. Select **Dismiss** to keep it silent. **Dismiss still adds the summary as a card.**

These summaries do not reliably show the web pages they came from.

## Show the presence orb to the room

The orb shows whether the app is idle, listening, thinking or speaking. It is a status light, not an avatar.

1. Select the orb on the toolbar to open presenter view. It shows a large orb and one of **Idle**, **Listening…**, **Thinking…** or **Speaking…**.
2. To leave, select **Exit presenter view**, click anywhere, or press Esc.

Presenter view does not tell participants what is being captured. Tell them yourself.

## Use the room camera

The camera is off each time the page loads. It counts faces and detects a raised hand. It does not identify people, and the app does not save or send camera images. The detection model files are downloaded from Google's servers each time the camera starts or from your browser's cache.

1. Tell the people in the room, and confirm that camera use is allowed.
2. Select **Enable room camera** (camera icon) and allow camera access.
3. Check the badge: **Camera active**, followed by the number in the room and **hand raised** when detected. The badge stays visible while the camera is on. No video preview is shown.
4. Select the camera button again to turn it off.

The count and hand signal are estimates. They are shown on screen only; the app does not act on them. If the model cannot load, the camera turns itself off and **Debug log** shows why.

## Follow the market strip

The strip shows **WTI Crude**, **Brent Crude**, **Henry Hub** and **NGL Conway**, then energy news headlines. A badge on the toolbar shows the **BKV** stock quote. These symbols cannot be changed on screen.

1. Read the prices and headlines. Treat them as indications, not live trading data. **NGL Conway is an estimate calculated from the WTI price**, although the strip does not label it. Henry Hub is the published figure adjusted by the app.
2. Point at the headlines to pause them. Select a headline with a link to open it in a new tab.
3. Select **Refresh market prices** to request current prices now. Otherwise the server updates them every few hours. This button does not refresh headlines.
4. If you have an EIA.gov key, enter it in **Settings** under **EIA.gov API Key** and select **Save**. Your key is used when you select Refresh. Without one, a rate-limited demo key is used.

**Market prices unavailable**, **No energy headlines available** or **BKV --** mean that no data could be fetched. The rest of the app still works. These figures may be included in what the app sends to your AI provider.

## Add documents for context

1. Under **Documents**, select **Add**.
2. Choose a `.txt`, `.md`, `.pdf`, `.docx`, `.html` or `.htm` file of 20 MB or less.
3. Wait for indexing to finish. The first upload can take a minute or more.
4. Check that the file is listed with its size and number of chunks.
5. To remove it, point at the file, select **Remove**, and confirm.

When you ask a question or cards are analysed, the app looks for passages related to the speech and sends the best matches to your AI provider. There is no document search box, you cannot open a document in the app, and answers do not reliably say which document they used. Documents are the only organisational data source; the app does not connect to your other systems. A scanned PDF with no text layer cannot be indexed.

## Manage action items

1. Type in **Add action item…** and press Enter or select the plus button.
2. To have the AI find items, select **Extract** after at least 20 words of transcript. It reads the most recent 400 words or so. After the first use the button is labelled **Extract from transcript**. Review every result. If the request fails, nothing may appear; run **Test AI**.
3. Select an item's checkbox to mark it done. Point at an item and select **Remove** to delete it.
4. To save the list, select **Export action items** (clipboard icon). It downloads `action-items.txt` with open and completed items. Nothing happens if the list is empty.

**Export before you leave the page.** The app does not show to-dos in History and does not reload them after you refresh the page or return later. They are not in the CSV export.

### Export to a calendar file (.ics)

1. Select **To Do** in the To-dos heading.
2. Select **Export .ics for Outlook**. The file contains the open items as tasks.

This button appears only while **no Microsoft client ID is saved** for your account. After you save one, use **Export action items** or send to Microsoft To Do. **Disconnect** does not remove the saved ID. Whether another program imports the file's tasks depends on that program.

## Send action items to Microsoft To Do

You need a Microsoft app registration and its **Application (client) ID**.

1. Select **To Do** in the To-dos heading.
2. Follow the five on-screen registration steps: open **portal.azure.com → App registrations → New**, allow **Personal Microsoft accounts only**, add the **Mobile and desktop** platform with the redirect address shown, add the delegated **Tasks.ReadWrite** permission, and copy the client ID. In the web app the on-screen portal link may not open; go to `portal.azure.com` yourself.
3. Paste the ID and select **Save & sign in**.
4. Go to `microsoft.com/devicelogin` (in the desktop app, **Open browser** opens it), enter the code shown, and sign in.
5. When the panel changes, choose a list and select **Send tasks**. Only open items are sent. With no open items it says **No open to-do items to send.**
6. **Check the list in Microsoft To Do.** The app's "Sent" count does not confirm that Microsoft accepted each task. Sending again creates duplicates.
7. To sign the account out of the app, open the panel and select **Disconnect**. **Disconnect** is available when the list view is showing, which needs at least one open item.

If the list menu is empty, disconnect and sign in again, or ask your administrator.

## Record screen and audio (desktop app)

**Record A/V** is separate from transcription. It records the primary screen, system audio where available (it is requested from Windows), and your default microphone.

1. Get consent from everyone who will be heard or seen, including remote participants. Close anything on your primary screen that should not be recorded.
2. Select **Record A/V**. If no meeting is active, one is created. The button changes to **Stop recording**.
3. To also get a live transcript, select **Start listening**.
4. Select **Stop recording**. The button shows **Saving…** while the file is saved. **End** also stops and saves the recording.
5. Open it from **History**, in the **Recording** tab.

Each meeting keeps **one** recording. Recording again in the same meeting **replaces the earlier file**. The recording is saved only when you stop, so do not close the app while recording or saving. The microphone menu does not choose the recording's microphone. If your microphone cannot be opened, recording continues without it; check **Debug log**.

## Review past meetings

1. Select **History** (clock icon). Each meeting shows its title, start time, duration or **in progress**, word count and card count. The card count can include deleted cards.
2. Select a meeting.
3. Select **Cards** to see its saved cards, pinned ones first, or **Transcript** to read the saved transcript.
4. If the meeting has a desktop recording, select **Recording** to play it.
5. Use the back arrow to return to the list, or the close button to return to the live screen.

### Generate a transcript from a recording (desktop app)

1. In the meeting's **Recording** tab, select **Generate transcript** and keep the meeting open until the progress bar shows **Done**.
2. Review the **Transcript** tab.

**This replaces the meeting's saved transcript.** If parts fail to transcribe, the result can be incomplete or empty, so copy any transcript you want to keep first. It uses the text currently in **Context** to correct names. Opening a different meeting stops it.

History does not carry anything into your next meeting: there is no project memory across meetings.

## Delete a meeting

1. Select **History** and open the meeting.
2. Select the trash button at the top.
3. Confirm **Delete this meeting and all its cards? This cannot be undone.**

This removes the meeting, its transcript, cards, cached research and recording. If the recording file cannot be deleted, an error appears and the meeting is kept. Close anything using the file and try again. Copies in backups or in files you downloaded are not changed.

## Export cards to CSV

1. Select **Export CSV** (download icon). Your browser downloads `meetings.csv`.
2. Open it. There is **one row for each saved card**, with the meeting ID, title, start and end times, word count, and the card's tag, title and text.

The file does **not** contain transcripts, to-dos or recordings. Meetings with no cards are left out. **Cards you deleted from the live screen are still included**, so review the file before sharing it.

## Clear the live screen

1. Make sure no meeting is active (select **End** if needed).
2. Select **Clear all** (trash icon on the toolbar). There is no confirmation.

This empties the live transcript, cards and to-do list. It does not delete saved meetings or documents. During an active meeting, see the warning under [Run a meeting](#run-a-meeting).

## Start and stop listening from another program

A Stream Deck or other tool on the same computer can start and stop **listening** in an open, signed-in app. Your administrator must set this up; see the administrator guide.

An MCP client can run `npm run mcp` from the application folder. Its tools are `start_meeting_recording` and `stop_meeting_recording`. Despite their names, they start and stop **listening**. They do not create a meeting, so nothing is saved unless you select **Record**, and they do not start **Record A/V**.

1. Get consent before any remote start.
2. Open the app and sign in.
3. Run the tool.
4. **Look at the app to confirm.** The start or stop button must change. The tool can report success even when no app window received the command.

## Troubleshooting

Open **Debug log** for more detail.

| What you see | What to do |
| --- | --- |
| **Incorrect email or password** | Check both, or use **Forgot password?** |
| **Email already registered** | Sign in instead, or reset the password. |
| **Reset link is invalid or has expired** | Request a new link. Links last 1 hour. |
| **Add an API key to get started** or **API key not configured** | Save a key for the selected provider in **Settings**. |
| **API key rejected** | Re-enter the key and check that it matches the provider. |
| **API account out of credits** | Check billing in your provider's account. |
| **Rate limited** | Wait; analysis tries again with new speech. |
| **Model not available** | Choose another model in **Settings**. |
| **Connection error** or **AI error** | Check the internet connection and Settings, then **Test AI**. If it followed transcription, select **Start listening** again. |
| **Microphone access denied** | Allow the microphone in the browser or operating system, then select **Start listening**. |
| **Web Speech API not available in this browser. Switch to Whisper.** | Select **Whisper**. |
| Listening, but no transcript | Check the microphone menu and level line, raise **Boost**, speak closer. Quiet or noisy audio is skipped. |
| **Not enough transcript yet** | Speak at least 20 words, then select **Extract**. |
| **Camera access denied** | Allow camera access, then try again. |
| **A/V recording is available in the desktop app.** | Use the desktop app. |
| **File too large (max 20 MB).** | Use a smaller file. |
| **Upload failed: trial_doc_limit** | The trial's 2 uploads are used. Activate a license. |
| **Upload failed: trial_expired** | The trial has ended. Activate a license. |
| **Upload failed: Unsupported file type** | Convert to a supported type. |
| **Upload failed: No text content found** | The file has little or no readable text. Use a text version. |
| **Upload failed: Extraction failed** | The file could not be read. Re-save it and try again. |
| **Invalid license key** or **Invalid or unrecognized license key.** | Copy the whole key, with no extra text. |
| **The meeting could not be deleted** | Check that the server is running. If the message mentions the recording file, close anything using it. |

## What leaves your computer

This build is **not** fully local. Choosing **Whisper** keeps speech-to-text on the app's server, but the text it produces can then be sent to your AI provider. In the web app, audio and saved data go to the hosting server.

| When | What is sent | To |
| --- | --- | --- |
| Card analysis while listening | Recent transcript (about 200 words), Context, matching document excerpts, titles of cards on screen, market figures | OpenAI or Anthropic |
| A spoken question | The question, Context, matching document excerpts, market figures, company research gathered in the meeting | OpenAI or Anthropic |
| **AI transcript cleanup** (on by default) | Transcript text and up to the first 4,000 characters of Context | OpenAI or Anthropic |
| **Extract** | Recent transcript (about 400 words) | OpenAI or Anthropic |
| Company research (Anthropic only, during a meeting) | Recent transcript to find names, then web searches about them | Anthropic |
| **Test AI** | A short test message | OpenAI or Anthropic |
| **Web Speech** mode | Microphone audio | The browser vendor's speech service |
| **Send tasks** | Open action-item text | Microsoft |

With no AI key saved, the AI requests above are not made, and cards, answers, extraction and cleanup do not work. Whisper transcription still works.

The app also contacts outside services without meeting content: market data (EIA, Yahoo Finance) and energy news feeds; downloads of the transcription, document-indexing and voice models (Hugging Face), the voice runtime (cdnjs) and camera models (Google); and the screen icons (jsDelivr). Without access to the icon host, some buttons can appear blank. Statements on screens or on the product's web page that everything runs locally do not apply to the features listed in the table.

## Known limitations

- **Consent:** no consent step or AI announcement. Capture can start without either.
- **AI backends:** only OpenAI and Anthropic. LM Studio, Claude Code and Codex cannot be selected.
- **Local use:** meeting text can leave your network, as listed above.
- **Sources:** cards and spoken answers do not reliably name their sources.
- **Asking:** voice only. No typed questions.
- **Muting:** no control stops or mutes a spoken answer that is already playing.
- **Speakers:** no speaker identification. **Others only** does not keep your words out of cards.
- **Materials:** the app makes cards and an action-item list. It does not create plans, documents, slides or code changes.
- **Memory:** no memory carries over from one meeting to the next. Live transcript and to-dos are not cleared automatically between meetings.
- **To-dos:** not shown in History or reloaded after a page refresh.
- **Transcript cleanup:** changes the screen only, not the saved transcript.
- **Exports:** CSV has card rows only and includes deleted cards.
- **Data sources:** uploaded documents only.
- **Meeting platforms:** no bot joins Zoom, Teams or Meet.
- **Avatar:** only the presence orb. The spoken voice cannot be changed on screen.
- **Desktop only:** **Record A/V**, recording playback and **Generate transcript**.
- **Chrome only:** **Web Speech**.
