# LexLatam Voice Agent

A realtime voice-agent engineering demo that uses [LexLatam](https://www.lexlatam.ai/) through the Model Context Protocol (MCP) for grounded legal research.

The project is intentionally small: its purpose is to demonstrate realtime voice interaction, MCP tool use, interruption handling, grounding, and latency observability—not to build another legal-research product.

> **Status:** Early technical spike / work in progress.

## What this demonstrates

The target interaction is simple:

1. A user asks a legal-research question by voice.
2. A realtime AI agent determines that legal research is required.
3. The agent invokes LexLatam through MCP.
4. LexLatam returns structured legal-search results.
5. The agent responds conversationally using the returned evidence.
6. The user can interrupt the agent while it is speaking.
7. The UI exposes tool calls, state transitions, interruptions, and latency.

The goal is to make the important systems behavior visible rather than hide everything behind a chatbot UI.

## Architecture

```mermaid
flowchart LR
    U[User / Microphone] --> B[Browser Voice UI]
    B <--> R[Realtime Voice Model]
    R -->|tool request| A[Voice Agent Backend]
    A -->|MCP| M[LexLatam MCP Server]
    M -->|structured legal results| A
    A --> R
    R -->|streaming audio| B

    subgraph Public Repository
        B
        A
    end

    subgraph External System
        M
    end