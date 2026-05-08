# copass-hermes-agents

Copass agent primitives for the Hermes API server (NousResearch hermes-agent),
routed to LLMs via OpenRouter.

This package owns the Hermes-specific backend and the
`CopassHermesAgent(BaseAgent)` convenience subclass. Hermes itself runs
inside a per-(user, sandbox) Daytona sandbox; this client speaks
HTTP/SSE to the sandbox endpoint via `httpx.AsyncClient`.

## Spike-locked posture (ADR 0008 Phase 1b)

- Stateless `/v1/chat/completions` only. The full conversation history
  is sent in `messages[]` on every turn — Hermes' on-disk session DB
  is unused.
- `Authorization: Bearer <API_SERVER_KEY>` on every call. The bearer
  is the per-sandbox caller-side key minted at provision time; it is
  NOT an LLM key.
- Single OpenRouter credential-pool entry per sandbox (no rotation).
  Hermes resolves the OpenRouter key from process env at agent
  construction time.
- Model strings use the `hermes/<openrouter-model-id>` shape; the
  backend strips the `hermes/` prefix before forwarding to Hermes.

## Conversation metadata: speaker + participants

When `auto_record=True` (the default when `window` is supplied), the
agent constructs a `CopassTurnRecorder` that auto-populates the
envelope's typed metadata on every turn:

- **`speaker`** — set from the `author` constructor arg on assistant
  turns; falls back to `"User"` / `"Assistant"` from the role on user
  turns.
- **`participants`** — defaults to `["User", author or "Assistant"]`.
  The roster rides on every turn so downstream retrieval can resolve
  second-person pronouns.

```python
agent = CopassHermesAgent(
    identity="support",
    system_prompt="You are helpful.",
    sandbox_url=os.environ["HERMES_SANDBOX_URL"],
    api_server_key=os.environ["HERMES_API_KEY"],
    window=window,
    author="agent:support-bot",   # → speaker on every assistant turn
    # participants auto-defaults to ["User", "agent:support-bot"]
)
```

If you need a richer roster (multi-party threads) or a logged-in user
identity, build a `CopassTurnRecorder` directly with `participants=...`
and `user_speaker="Alice"`, then pass `auto_record=False` to the agent
and drive recording yourself. See
[`copass-context-agents`](../copass-context-agents) for the recorder
surface and full envelope semantics.
