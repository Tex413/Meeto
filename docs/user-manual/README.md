# Meeteor user manual

Supported runtime: 2.1.0. The current screens and installer still say **Meetintel**. This manual describes the application in this repository; the owner's planned local meeting intelligence is not yet implemented.

## Open the app and sign in

1. In a browser, open the address supplied by your administrator. For a local server using the default port, open `http://localhost:7432`.
2. On the sign-in screen, use **Sign in** with your email and password, or choose the registration tab to create an account.
3. If you forgot your password, use **Forgot password** and follow the reset link sent by the configured mail service. Ask an administrator if mail delivery is unavailable.
4. Use **Sign out** in the app toolbar when finished. The desktop app opens directly as a single local user and has no sign-in screen.

## Configure AI and audio

1. Select **Settings** (gear) on the toolbar.
2. Choose **AI Provider** (OpenAI or Anthropic) and a **Model**. Enter the corresponding API key in its field and select **Save**. The status text shows whether a key is saved; the field itself is cleared when Settings opens again.
3. If desired, set the **Wake word** and **Injection mode** in the same dialog. The latter is marked as applying to the Anthropic provider.
4. For transcription, choose **Web Speech** (Chrome only) or **Whisper** above the live transcript. Web Speech is unavailable in Electron. Choose a microphone from **Microphone source**.
5. Adjust **Interval**, **Terseness**, **Others only / Everyone / Fact-check me**, **Echo**, **Denoise**, **AGC**, **Boost**, and **Chunk** as needed. Restart listening after changing Echo, Denoise, or AGC to apply the new microphone constraints. Hold **Space** while speaking to mark your own voice in the push-to-talk flow.
6. Select **Test AI** to check the configured AI connection. Open **Debug log** to inspect messages; its **copy**, **clear**, and **hide** controls affect the visible log.

The Settings dialog also has an **EIA.gov API Key** field for the market strip. An administrator can configure a key through the approved secret workflow; the interface says its fallback demo key is rate limited.

The current Settings screen has no LM Studio, Claude Code, or Codex backend selector. API-backed AI functions may send supplied content to the selected provider. The interface does not enforce a meeting consent step before capture; obtain participant consent yourself before using any listening or recording control.

## Run a meeting and transcribe it

1. Tell participants that AI assistance and capture will be used, and obtain the consent required for your meeting before proceeding.
2. Enter a **Session title** and optional text in **Context**. Context can include notes for the insight cards. The **AI transcript cleanup** checkbox controls optional cleanup using the configured API key.
3. Select **Record** to create the meeting entry. This button alone starts the meeting record; use **Start listening** to open the microphone and populate **Live transcript**.
4. Select **Start listening** again to stop listening. Select **End** to save and close the meeting; ending also stops active listening and A/V recording.
5. In the desktop app, **Record A/V** captures the primary screen, available system audio, and microphone to a recording attached to the meeting. Select it again to stop. This control is hidden in the browser app.

## Use cards, answers, and room controls

1. Add meeting context in **Context**, or add documents as described below, then start listening. Generated cards appear in **Insight cards** when topics are detected.
2. Type in **Filter cards** to narrow the live list; use the clear icon to remove the filter. Use **Auto-clear** to fade unpinned cards from the live pane after the selected interval; meeting history remains available.
3. Use a card's available actions, including pinning, to manage it. Use **Clear all** to reset the current transcript, cards, and to-dos in the live view.
4. Select the presence orb to open **Presenter view** and **Exit presenter view** to close it. If a suggestion appears, use **Speak** or **Dismiss**.
5. Use the camera button to toggle room-camera presence and hand-raise detection. The UI describes this as ephemeral. Verify your room's privacy requirements before enabling it.

Do not assume every generated factual statement carries a source citation; source attribution is not enforced by the current card path.

## Ask a spoken question

1. In **Settings**, enter the **Wake word** and select **Save**. The badge beside the presence orb displays the current word and injection mode.
2. Start a meeting and select **Start listening**. Say the wake word followed by your question; the app sends the recognized question to its configured AI provider and presents a spoken answer when the request succeeds.
3. For Anthropic, choose **Ask-only** or **Suggest & approve** under **Injection mode**. In the latter mode, a research suggestion may appear; select **Speak** to voice it or **Dismiss** to close it. Use **Start listening** again to stop microphone capture immediately.

The current question flow is voice driven; there is no text question box on the meeting screen. Verify important answers against their original source because citation display is not guaranteed.

## Follow the market strip

1. Read the market prices and energy headlines in the strip above the meeting controls. The BKV badge shows a separate stock quote when data is available.
2. Select **Refresh market prices** to request a fresh price update. Select a linked headline to open its source in a new tab.
3. If the strip has no data, continue the meeting without it; these values depend on the configured upstream feeds.

## Add documents for card context

1. Expand **Documents** and select **Add**.
2. Choose a `.txt`, `.md`, `.pdf`, `.docx`, `.html`, or `.htm` file. Uploaded text is indexed for document search and card context.
3. Review the file in the Documents list. Use its **Remove** control to delete it from this app.

## Manage action items and Microsoft To Do

1. Expand **To-dos**, type an item in **Add action item**, and press Enter or the plus button.
2. Select **Extract** to ask AI to find action items in the transcript. Review the resulting items before relying on them.
3. Use the toolbar's **Export action items** button to export the list. The Microsoft To Do panel also offers **Export .ics for Outlook** without sign-in.
4. To send tasks to Microsoft To Do, open **To Do**, enter your Microsoft app client ID, choose **Save & sign in**, complete the displayed device login in a browser, select a list, and choose **Send tasks**. Use **Disconnect** in that panel to disconnect the account.

The toolbar's **Export CSV** link downloads saved meeting data in CSV format.

## Find, export, or delete a past meeting

1. Select **History** in the toolbar and choose a meeting.
2. Switch among **Cards**, **Transcript**, and, when a desktop recording exists, **Recording**. The Recording tab offers playback and **Generate transcript**.
3. Use the trash button in meeting detail to delete that meeting. This is destructive. The back arrow returns to the history list and the close button returns to the live view.

## Licensing and trial

If the trial notice appears, select it to open the license dialog. Use **See pricing** to open the site's pricing page, or enter an issued license key and select **Activate**. The desktop activation screen also accepts a key and offers **Activate**. Ask your administrator for license questions; do not put a key in support correspondence.

## Local MCP recording controls

An MCP client can run `npm run mcp` from the application folder. Its tools are `start_meeting_recording` and `stop_meeting_recording`; they call the running local app's recording control endpoints. The client must point `MEETO_BASE_URL` at the local app (default `http://127.0.0.1:7432`; desktop defaults to port 7433). Obtain consent before invoking either tool.
