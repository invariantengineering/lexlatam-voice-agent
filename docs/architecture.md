# Architecture walkthrough

The demo connects a browser voice session to one legal-search tool. It uses the
official service SDKs, with no agent framework, database or provider abstraction.

## Follow one conversation

1. **Start in the browser.** `src/voice.ts` checks configuration, requests the
   microphone, creates a WebRTC peer and opens a data channel for session events.
   It sends an SDP offer, which describes the media connection, to `POST /api/session`.
2. **Prepare the backend.** `server/app.ts` validates the local request.
   `server/call.ts` initializes the MCP client and checks that `search_panama_law`
   has the expected schema. This currently makes research availability a startup
   dependency even for ordinary conversation.
3. **Connect voice.** The backend creates a Realtime call with the SDP offer and
   Spanish session configuration, then attaches an authenticated sideband
   WebSocket to the returned call ID. The browser applies the SDP answer and
   exchanges audio directly with Realtime over WebRTC.
4. **Recognize a turn.** Native semantic VAD estimates whether the speaker has
   finished a thought. Low eagerness gives more room for pauses while speaking.
   Realtime sends completed input transcription and response-audio transcript
   events. `src/App.tsx` renders them while the browser plays the incoming audio.
   Transcription displays the audio exchange; there is no separate text-model pipeline.
5. **Research when requested.** The session instructions ask the model to use
   `search_panama_law` before giving a legal answer. A completed function call
   arrives on the backend's sideband. The backend validates its name and query,
   invokes MCP, checks the result and returns a function output. It then requests
   a response based on that evidence. The UI shows validated source fields
   alongside the spoken summary so the presenter can compare them.
6. **End the session.** Stop closes the browser peer and microphone tracks and
   requests backend cleanup. The backend cancels pending research, closes MCP and
   the sideband, and hangs up the provider call. A ten-minute limit bounds abandoned sessions.

## Choices and tradeoffs

| Choice | Reason and practical limit |
| --- | --- |
| WebRTC for browser audio | Uses browser media transport directly; the application backend does not relay every audio packet. Browser microphone permissions and speaker playback remain prerequisites. |
| Server-side session creation and sideband | Keeps credentials and tool execution on the backend. The Node WebSocket transport supplies bearer-header authentication for call attachment. |
| Native semantic VAD, low eagerness | Allows thinking pauses without a custom turn detector. It considers whether speech sounds complete rather than ending every turn after 500 ms of silence. Responses can take longer when completion is uncertain. Automatic response and barge-in remain enabled. |
| One tool with bounded evidence | Queries accept only a nonempty `query` string of at most 2,000 characters. At most three validated sources enter the response, including citations and safe source links. |
| Duplicate and stale-call guards | A set of call IDs prevents repeated execution. A turn counter prevents results from an older turn from grounding the current response. This does not establish comprehensive concurrency guarantees. |
| Polling for tool status | A one-second poll keeps the UI simple. Display updates may lag execution; the shown tool duration measures backend validation and search handling, not end-to-end voice latency. |
| In-memory state | Makes the important code easy to inspect. Reloads and restarts lose state; there is no conversation archive or multi-user deployment model. |

MCP uses Streamable HTTP with a server-held bearer token. The client locally opts
out of the optional standalone GET notification stream because that stream
blocked initialization on the tested endpoint. POST requests and their SSE
responses still use the official SDK. An MCP `isError` result is treated as a
failure even when the HTTP request succeeds; no anonymous retry is implemented.

The prompt requires retrieved evidence for legal answers, but it is not a proof
of grounding. The acceptance check must compare the spoken answer with the actual
returned citations. Retrieval does not establish the law's applicability.

## Verification record

On September 16, 2026:

- The presenter confirmed the live voice demo; the [capture](images/voice-conversation.png)
  shows user and agent transcripts and the UI returned to its idle state.
- A synthetic Spanish greeting sent through the application's actual
  `POST /api/session` path produced a completed input transcription, response
  audio events and a completed Spanish response transcript. This check did not
  use the microphone or independently establish audible speaker playback.
- Authenticated MCP initialization and `tools/list` succeeded. These checks did
  not execute a legal search or prove that private access was enforced remotely.
- Typecheck, eighteen deterministic tests and the production build passed before
  this documentation update; CI runs those checks for each PR revision.

The presenter subsequently confirmed cited answers through the local MCP voice
flow: first Law 81, then a three-question sequence about the Labor Code's
probation period. A follow-up with incomplete evidence acknowledged that limit.
Deliberate interruptions stopped speech as expected. Pauses were initially split
too eagerly by a 500 ms silence detector; the presenter accepted the adjustment to
[semantic VAD with low eagerness](https://developers.openai.com/api/docs/guides/realtime-vad#semantic-vad).
Stopping released the microphone, and another conversation started successfully
without reloading the page.

These are local acceptance results, not a comprehensive evaluation of retrieval
or interruption races. Delayed stale-tool results are also covered by a
deterministic test. Retrieval relevance and currency remain research-service
concerns; the voice layer must represent evidence and its limits faithfully.

### One real tool-duration sample

In the presenter's September 16 probation-period conversation, the final tool
panel reported `search_panama_law`, **success**, **4.2 seconds**, and **three
sources**. The spoken follow-up asked what happens if a worker previously held
the same position in the same company. The displayed primary excerpt and the
spoken answer both addressed that condition, citing the Labor Code,
Decreto de Gabinete No. 252 de 30 de diciembre de 1971, G.O. 17040,
18/02/1972, p. 22.

The value is the UI's rounded backend tool duration: argument validation,
the MCP request and result validation. It excludes session setup and does not
measure time from the end of speech to audible response. This is one observed
run, not an average, percentile or performance guarantee. The transcript and
tool panel were supplied by the presenter; no latency is inferred from their
wall-clock timestamps.

### Environment boundaries

The client now defaults to `http://localhost/mcp/`, permits HTTP for loopback and
`host.docker.internal`, and retains HTTPS for remote services. Each HTTP request
has a 120-second deadline that also covers response-body consumption; tool calls
have the same request budget. This bounds the entire request rather than resetting
the timer whenever data arrives. MCP initialization and tool discovery retain
their existing 15-second startup limits. Stage and production private access are
not verified. The deployed endpoint returned a guest-limit tool error during
testing despite receiving a bearer header, so it is not a substitute for local
private-access validation.

## Two-minute demo script

Target roughly two minutes; leave room for actual search and response times.
The recording is a follow-up artifact, not a prerequisite for merging the demo.

**0:00–0:30 — English architecture intro.** Show the README diagram briefly:

> I built this realtime voice-agent demo solo in under 24 hours using AI-assisted
> coding tools. The browser connects directly to OpenAI Realtime over WebRTC.
> A Node backend owns tool execution and credentials. Legal research comes from
> LexLatam, my separate platform, through MCP. Its proprietary retrieval stays
> behind that interface. Let me show you a call.

**0:30–1:50 — Spanish conversation.** Start the session and wait for **Escuchando**.
Keep the tool panel and citations visible. Use the sequence already exercised live:

1. “Hola, buenas tardes. Quisiera hacer una consulta sobre derecho laboral en Panamá.”
2. “Según el Código de Trabajo de Panamá, ¿qué puede hacer cualquiera de las
   partes durante el período probatorio?”
3. “Entiendo. ¿Y cuánto puede durar ese período? ¿Tiene que constar expresamente
   en el contrato escrito?”
4. While the agent is speaking, interrupt: “Espera, disculpa. ¿Qué pasa si el
   trabajador ya había ocupado esa misma posición en la misma empresa?”

Compare the spoken summary with the displayed excerpt, citation and tool status.
Show the actual tool duration from the recording. Do not substitute the recorded
4.2-second sample if the new run takes a different amount of time.

**1:50–2:10 — Close.** “Perfecto, eso era lo que quería saber. Muchas gracias por
la ayuda. Que tengas buena tarde. Hasta luego.” Click **Terminar conversación**
and show the return to the idle state. This is browser audio; no telephone or
telephony integration is part of the demo.
