# Realtime voice demo plan

Deliver a two-minute Spanish conversation that retrieves real LexLatam evidence
and speaks a grounded answer. The first milestone is a working end-to-end demo,
with minimal visible state and MCP tool name, status and latency.

## Progress — September 16, 2026

All three milestones are complete for the local portfolio demo. The presenter
confirmed Spanish voice, cited answers through authenticated local MCP, native
barge-in, the more patient semantic turn detection, and stopping/restarting without
reloading. Live examples cover Law 81 and the Labor Code's probation period;
an unsupported follow-up acknowledged incomplete evidence.

The README, architecture diagram, real conversation screenshot, 4.2-second tool
sample and two-minute demo script are recorded. A video can be linked after
recording; it is not a code-merge requirement. See the
[verification record](docs/architecture.md#verification-record).
Custom interruption infrastructure and remote deployment remain out of scope.
This reduced three-milestone plan supersedes the original PRD's broader slice list.

## Selected stack

- TypeScript 7.0.2; React 19.3.0; Vite 8.3.0; plain CSS.
- Node.js 24+; Express 5.2.1; official OpenAI SDK 7.15.0.
- OpenAI **Realtime API (GA)**, model `gpt-realtime-2.1`, voice `marin`.
  Browser WebRTC; server-mediated `/v1/realtime/calls` session creation;
  native semantic VAD with low eagerness. Use Realtime event types consistently.
- Server sideband WebSocket for tool execution and session control.
- Official MCP TypeScript SDK: `@modelcontextprotocol/sdk@1.30.0`, pinned for
  implementation. Authenticated initialization, tool discovery and real searches
  have been exercised through the local MCP voice flow.
- Vitest 5.0.1 for deterministic behavior. One package; no agent framework.

## Architecture and trust boundary

```mermaid
flowchart LR
    B[Browser: React] <-->|WebRTC audio and events| R[OpenAI Realtime]
    B <-->|Session setup and sanitized telemetry| N[Node backend]
    R <-->|Server sideband: control and tool calls| N
    N <-->|Official MCP client; server-side credentials| M[LexLatam MCP]
    subgraph External proprietary service
        M
    end
```

The backend alone executes `search_panama_law` at the configured
`LEXLATAM_MCP_URL`, defaulting to `http://localhost/mcp/`. It discovers the schema,
validates arguments, deduplicates tool-call IDs, bounds and validates results,
and rejects stale results before supplying evidence to the model. No proprietary
retrieval implementation enters this repository. Remote private access remains
unverified; local HTTP requests use a 120-second deadline including body reads.

## Three milestones

The original active-work estimate is retained below; it is not a time log.

1. **Complete — Working demo (estimated 2–4 active hours):** confirm access and contracts (15–30 min),
   complete the Spanish voice loop (30–60 min), connect real legal research
   (45–90 min), then show minimal state/tool timing and verify the complete flow
   (30–60 min). Use one implementer and report a runnable checkpoint or a specific
   blocker after each step. Stop for the presenter's test before further work.
2. **Complete — Optional barge-in:** assess native WebRTC/VAD interruption first. Add only
   essential stale-turn protection if straightforward. Limit custom work to
   45 minutes; otherwise defer it and document the limitation.
3. **Complete — Portfolio polish:** concise README, architecture Mermaid, one screenshot,
   one real latency sample and a two-minute demo script. Stop.

Run typecheck and build, plus trivial tests protecting important deterministic
boundaries. Record live verification separately from fixtures or static checks.
No separate observability, state-machine, concurrency or test-suite projects.

## Definition of done

A real authenticated MCP search supports a spoken Spanish answer. The UI shows
the tool name, success/failure and real measured tool duration. Native interruption
is evaluated separately and is not a prerequisite for the first demo milestone.
Retrieved citation cards use only validated MCP fields. Unsupported answers admit
that available evidence is insufficient; retrieval does not establish legal
validity or applicability. Local checks pass and the presenter can reproduce the
two-minute demo. Optional work must not delay this result.

## Non-goals

No accounts, auth UI, persistence, database, billing, telephony, mobile app,
multiple providers or servers, custom retrieval, orchestration framework,
production deployment, infrastructure changes or LexLatam modifications.
No arbitrary payload logging, credentials in the browser or committed secrets.

## Contract references

- [Realtime API](https://developers.openai.com/api/docs/guides/realtime)
- [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime)
- [Server controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=realtime)
- [MCP TypeScript client](https://ts.sdk.modelcontextprotocol.io/client)
- [LexLatam public MCP](https://www.lexlatam.ai/servidor-mcp-panama)
