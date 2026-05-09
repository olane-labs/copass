import type { CopassClient } from '../client.js';
import { ContextWindow } from './context-window.js';
import type {
  AttachContextWindowOptions,
  CreateContextWindowOptions,
} from './types.js';

/**
 * Factory for {@link ContextWindow} instances.
 *
 * Accessed via `client.contextWindow`. `create()` registers a new ephemeral
 * data source and returns a window bound to it; `attach()` rehydrates a
 * window against an existing `data_source_id` the caller persisted.
 */
export class ContextWindowResource {
  constructor(private readonly client: CopassClient) {}

  /** Register a fresh ephemeral data source and return a window bound to it. */
  async create(options: CreateContextWindowOptions): Promise<ContextWindow> {
    const name = options.name ?? `window-${Date.now()}`;
    const source = await this.client.sources.register(options.sandbox_id, {
      provider: 'custom',
      name,
      ingestion_mode: 'manual',
      kind: 'ephemeral',
    });

    return new ContextWindow({
      client: this.client,
      sandboxId: options.sandbox_id,
      dataSourceId: source.data_source_id,
      projectId: options.project_id,
      participants: options.participants,
    });
  }

  /**
   * Reattach to an existing source — typically one the caller persisted
   * on their side after an earlier `create()`.
   */
  async attach(options: AttachContextWindowOptions): Promise<ContextWindow> {
    const source = await this.client.sources.retrieve(
      options.sandbox_id,
      options.data_source_id,
    );

    return new ContextWindow({
      client: this.client,
      sandboxId: options.sandbox_id,
      dataSourceId: source.data_source_id,
      projectId: options.project_id,
      initialTurns: options.initialTurns,
      participants: options.participants,
    });
  }
}
