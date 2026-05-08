import { BaseDataSource, type BaseDataSourceOptions } from '../data-sources/base.js';
import type { ChatMessage } from '../resources/retrieval.js';

export interface ContextWindowOptions extends BaseDataSourceOptions {
  /** Pre-existing turns to seed the local buffer, e.g. when resuming. */
  initialTurns?: ChatMessage[];
}

/**
 * An agent's conversation wrapped as an ephemeral data source.
 *
 * Each call to {@link addTurn} appends a turn to the local buffer and pushes
 * its content through the underlying data source, so the thread itself
 * becomes retrievable. Pass the window to any `client.retrieval.*` call to
 * get window-aware retrieval without hand-managing a `history` array.
 *
 * Construct via {@link ContextWindowResource.create} for a fresh thread or
 * {@link ContextWindowResource.attach} to resume an existing one.
 */
export class ContextWindow extends BaseDataSource {
  private readonly turns: ChatMessage[];

  constructor(options: ContextWindowOptions) {
    super(options);
    this.turns = [...(options.initialTurns ?? [])];
  }

  /**
   * Append a turn and push it through the underlying data source.
   *
   * Awaits the push so ingestion failures surface at the call site. Callers
   * wanting fire-and-forget can drop the `await` or wrap in `void`.
   *
   * The turn's `name` (if set) is forwarded as the envelope's
   * `speaker` field; absent `name` falls back to the capitalized
   * `role` (`'user'` → `'User'`, `'assistant'` → `'Assistant'`). The
   * `${role}: ${content}` content-prefix munging the prior version
   * used has been retired — the wire body is now the message
   * `content` verbatim, with `speaker` riding on the envelope.
   */
  async addTurn(turn: ChatMessage): Promise<void> {
    this.turns.push(turn);
    const speaker = turn.name ?? capitalizeRole(turn.role);
    await this.push(turn.content, {
      sourceType: 'conversation',
      speaker,
    });
  }

  /** Current turn log — returned as a defensive copy so callers can't mutate internal state. */
  getTurns(): ChatMessage[] {
    return [...this.turns];
  }

  /** Mark the underlying source as disconnected. Best-effort — idempotent on the server. */
  async close(): Promise<void> {
    await this.disconnect();
  }
}

function capitalizeRole(role: string): string {
  if (!role) return role;
  return role[0]!.toUpperCase() + role.slice(1);
}
