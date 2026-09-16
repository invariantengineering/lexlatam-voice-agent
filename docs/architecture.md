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
4. **Recognize a turn.** Server VAD detects speech and the following pause.
   Realtime sends completed input transcription and response-audio transcript
   events. `src/App.tsx` renders them while the browser plays the incoming audio.
   Transcription displays the audio exchange; there is no separate text-model pipeline.
5. **Research when requested.** The session instructions ask the model to use
   `search_panama_law` before giving a legal answer. A completed function call
   arrives on the backend's sideband. The backend validates its name and query,
   invokes MCP, checks the result and returns a function output. It then requests
   a response based on that evidence. The legal grounding behavior still needs live acceptance.
6. **End the session.** Stop closes the browser peer and microphone tracks and
   requests backend cleanup. The backend cancels pending research, closes MCP and
   the sideband, and hangs up the provider call. A ten-minute limit bounds abandoned sessions.

## Choices and tradeoffs

| Choice | Reason and practical limit |
| --- | --- |
| WebRTC for browser audio | Uses browser media transport directly; the application backend does not relay every audio packet. Microphone permissions and speaker playback still need browser testing. |
| Server-side session creation and sideband | Keeps credentials and tool execution on the backend. The Node WebSocket transport supplies bearer-header authentication for call attachment. |
| Native server VAD | Avoids a custom interruption system. The configured 500 ms silence threshold can split speech at pauses; interruption quality is not yet evaluated. |
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
- Typecheck, eight deterministic tests and the production build passed before
  this documentation update; CI runs those checks for each PR revision.

Remaining: private-MCP integration against the reachable local endpoint,
authenticated search through the voice session, citation-grounded spoken output,
a recorded tool-latency sample, and a full stop/reconnect acceptance check.
The existing integration still requires HTTPS and uses a 30-second search request
timeout; it has not yet adopted the requested local HTTP contract and 120-second
read timeout. Stage and production private access are not verified.

## Two-minute demo script

**0:00–0:20 — Explain the boundary.** “The browser sends audio directly to the
voice service. A small backend owns credentials and executes legal research.”

**0:20–0:55 — Demonstrate the verified voice path.** Start a session, wait for
**Escuchando**, and say “Hola, respóndeme brevemente en español.” Pause, listen
to the reply and point out the completed transcripts.

**0:55–1:25 — Explain tool execution.** Show the architecture diagram and describe
the validated query, returned citations and stale-result guard. Until legal-search
acceptance passes, describe this as the next integration step. Once validated,
use “¿Qué regula la Ley 81 de 2019 en Panamá?” and compare the answer with the
tool panel. Report only the measured tool duration, not an inferred voice latency.

**1:25–2:00 — Stop and discuss the tradeoff.** End the session. Explain why native
VAD and a single tool keep the project small, what the eight tests protect, and
what still requires live verification.
