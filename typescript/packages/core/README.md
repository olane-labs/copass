# @copass/harness

TypeScript client SDK for the [Copass](https://copass.id) knowledge graph platform.

## Installation

```bash
npm install @copass/harness
```

Requires Node.js >= 18.0.0.

## Usage

```typescript
import { CopassClient } from '@copass/harness';

const client = new CopassClient({
  auth: { type: 'api-key', key: 'olk_your_api_key' },
});

// Natural language search
const result = await client.matrix.query({
  query: 'How does authentication work?',
});

// Ingestion (auto-resolves caller's primary sandbox + default project)
const job = await client.ingest.text({
  text: 'const x = 1;',
  source_type: 'code',
});
const status = await client.ingest.getJob(job.job_id);
```

## Conversation metadata: speaker, participants, timestamp

The ingest envelope carries optional metadata that travels alongside
the content. Set them when the data is conversation-shaped so the
platform can attribute and order content correctly.

| Field | Where | What it means |
|---|---|---|
| `occurred_at` | `IngestTextRequest`, `BaseDataSource.push`, `client.sources.ingest` | ISO 8601 timestamp anchoring this payload to a real-world moment. |
| `speaker` | Same | Name of the participant who uttered this payload. Caller-decided literal (`'User'`, `'Assistant'`, `'Alice'`, an email address, …). |
| `participants` | Same | Roster of participants present in this artifact. Per-message — pass the snapshot at the time of utterance. |
| `source_type` | Same | Hint describing the payload kind. Conventional values: `'text'`, `'markdown'`, `'code'`, `'json'` (content-shape) or `'conversation'`, `'ticket'`, `'email'`, `'note'` (artifact-kind). Free-form string. |

### Direct API

```typescript
await client.ingest.text({
  text: 'Hey Alice, did you finish the report?',
  source_type: 'conversation',
  speaker: 'Bob',
  participants: ['Alice', 'Bob'],
  occurred_at: '2026-05-08T15:30:00Z',
});
```

### Through a `ContextWindow`

For a chat-style agent, set the participant roster once at window
construction; it forwards on every `addTurn` call. Set
`ChatMessage.name` when you want a richer speaker than the role-derived
default (`'User'` / `'Assistant'`):

```typescript
const window = await client.contextWindow.create({
  sandbox_id,
  participants: ['User', 'Alice'],   // default roster, applied on every turn
});

// Role-only — speaker derived as capitalized role.
await window.addTurn({ role: 'user', content: 'Hey Alice…' });

// Named participant — `name` overrides the role-derived speaker.
await window.addTurn({
  role: 'user',
  content: '…thanks!',
  name: 'Bob',
});

// Per-call override — use when the roster shifts mid-conversation.
await window.addTurn(
  { role: 'assistant', content: '…' },
  { participants: ['User', 'Alice', 'Bob', 'Carol'] },
);
```

### Through a `BaseDataSource` subclass

```typescript
class SlackChannelSource extends BaseDataSource {
  async pushMessage(msg: SlackMessage) {
    await this.push(msg.text, {
      sourceType: 'conversation',
      speaker: msg.authorName,
      participants: msg.channel.memberNames,
      occurredAt: msg.postedAtIso,
    });
  }
}
```

Existing callers that don't pass any of these fields keep working —
all four are optional.

## Documentation

See the [main documentation](../docs/) for architecture, API reference, and guides.

## License

MIT
