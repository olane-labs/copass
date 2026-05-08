import { BaseDataSource, ensureDataSource } from '@copass/core';
import type {
  BaseDataSourceOptions,
  CopassClient,
  DataSourceIngestionMode,
  ProjectConfig,
} from '@copass/core';
import { runFullIndex } from './indexer/index.js';
import { ProjectWatchRuntime } from './watch/index.js';
import type { WatchRunSummary } from './watch/index.js';
import type { FullIndexSummary } from './types.js';

export interface FileSystemDataSourceOptions extends BaseDataSourceOptions {
  /** Absolute path to the project root this source mirrors. */
  projectPath: string;
  /** Optional project config. Defaults to the core `defaultProjectConfig()`. */
  config?: ProjectConfig;
  /** Run as a managed service (launchd/systemd). Passed to the watch runtime. */
  service?: boolean;
  /** Cap the number of files processed per run. */
  maxFiles?: number;
}

export interface CreateFileSystemDataSourceOptions {
  client: CopassClient;
  sandboxId: string;
  projectPath: string;
  /** Human-readable name for the data source record. Defaults to the basename of `projectPath`. */
  name?: string;
  /** Storage project id to attribute ingestions to. Optional. */
  projectId?: string;
  /** Ingestion mode to register under. Defaults to `manual` — your code drives pushes. */
  ingestionMode?: DataSourceIngestionMode;
  /** Extra adapter_config merged on top of `{ root: projectPath }`. */
  adapterConfig?: Record<string, unknown>;
  /** If a matching source already exists in the sandbox, reuse it. Defaults to `true`. */
  reuseExisting?: boolean;
  config?: ProjectConfig;
  service?: boolean;
  maxFiles?: number;
}

/**
 * Filesystem data source driver.
 *
 * Binds a registered `DataSource` (provider = `"custom"`, named after the
 * project) to a local directory. Every file event — from the initial full
 * index or ongoing watcher — is pushed through
 * `client.sources.ingest(sandboxId, dataSourceId, …)` so attribution stays
 * coherent with the rest of the copass-id storage layer.
 *
 * @example
 * ```ts
 * const fs = await FileSystemDataSource.create({
 *   client,
 *   sandboxId,
 *   projectPath: '/path/to/repo',
 *   name: 'my-repo',
 * });
 *
 * const summary = await fs.fullIndex();
 * await fs.start(); // starts chokidar watcher
 * ```
 */
export class FileSystemDataSource extends BaseDataSource {
  readonly projectPath: string;
  private readonly config?: ProjectConfig;
  private readonly service: boolean;
  private readonly maxFiles?: number;
  private watcher: ProjectWatchRuntime | null = null;

  constructor(options: FileSystemDataSourceOptions) {
    super(options);
    this.projectPath = options.projectPath;
    this.config = options.config;
    this.service = options.service ?? false;
    this.maxFiles = options.maxFiles;
  }

  /**
   * Register (or reuse) a filesystem data source in the given sandbox and
   * return a bound driver instance.
   */
  static async create(
    options: CreateFileSystemDataSourceOptions,
  ): Promise<FileSystemDataSource> {
    const source = await ensureDataSource(options.client, options.sandboxId, {
      provider: 'custom',
      name: options.name ?? pathBasename(options.projectPath),
      ingestion_mode: options.ingestionMode ?? 'manual',
      adapter_config: { root: options.projectPath, ...(options.adapterConfig ?? {}) },
      reuseExisting: options.reuseExisting,
    });

    return new FileSystemDataSource({
      client: options.client,
      sandboxId: options.sandboxId,
      dataSourceId: source.data_source_id,
      projectId: options.projectId,
      projectPath: options.projectPath,
      config: options.config,
      service: options.service,
      maxFiles: options.maxFiles,
    });
  }

  /** One-shot full index of the project tree. */
  async fullIndex(options: { dryRun?: boolean; onProgress?: (msg: string) => void } = {}): Promise<FullIndexSummary> {
    return runFullIndex(this.client, {
      projectPath: this.projectPath,
      sandboxId: this.sandboxId,
      dataSourceId: this.dataSourceId,
      projectId: this.projectId,
      config: this.config,
      maxFiles: this.maxFiles,
      dryRun: options.dryRun,
      onProgress: options.onProgress,
    });
  }

  /**
   * Start the chokidar watcher. Idempotent — calling twice replaces the
   * previous watcher. The initial reconcile summary is stored on the
   * instance; access it via {@link lastReconcileSummary} or call
   * {@link reconcile} separately beforehand.
   */
  async start(): Promise<void> {
    if (this.watcher) await this.watcher.stop();
    this.watcher = new ProjectWatchRuntime(this.client, {
      projectPath: this.projectPath,
      sandboxId: this.sandboxId,
      dataSourceId: this.dataSourceId,
      projectId: this.projectId,
      config: this.config,
      service: this.service,
      maxFiles: this.maxFiles,
    });
    this._lastReconcileSummary = await this.watcher.start();
  }

  private _lastReconcileSummary: WatchRunSummary | null = null;

  /** Summary of the most recent reconcile (from `start()` or `reconcile()`). */
  get lastReconcileSummary(): WatchRunSummary | null {
    return this._lastReconcileSummary;
  }

  /** Stop the watcher and release chokidar resources. */
  async stop(): Promise<void> {
    if (!this.watcher) return;
    await this.watcher.stop();
    this.watcher = null;
  }

  /** Run a one-time reconcile without starting the watcher. */
  async reconcile(): Promise<WatchRunSummary> {
    const runtime = new ProjectWatchRuntime(this.client, {
      projectPath: this.projectPath,
      sandboxId: this.sandboxId,
      dataSourceId: this.dataSourceId,
      projectId: this.projectId,
      config: this.config,
      service: this.service,
      maxFiles: this.maxFiles,
    });
    const summary = await runtime.reconcile();
    this._lastReconcileSummary = summary;
    return summary;
  }
}

function pathBasename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
