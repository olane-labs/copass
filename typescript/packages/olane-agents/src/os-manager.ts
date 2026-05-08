import {
  startLocalOsInstance,
  statusLocalOsInstance,
  stopLocalOsInstance,
} from '@copass/datasource-olane';
import type {
  OlaneOSManagerOptions,
  OsRunningInfo,
  OsStatus,
} from './types.js';

/**
 * Singleton local Olane OS host with a circuit-relay-v2 server mounted.
 *
 * Wraps `@copass/datasource-olane`'s `startLocalOsInstance` /
 * `statusLocalOsInstance` / `stopLocalOsInstance`, which themselves wrap
 * `@olane/os`'s `startOS` / `statusOS` / `stopOS`. The relay node is
 * mounted by the host process via `runOlaneOSHost` (the body the
 * detached child runs).
 *
 * State lives at `<DEFAULT_CONFIG_PATH>/os-instances/<instanceName>/config.json`
 * — the canonical `@olane/os` `ConfigManager` layout. Front-ends should
 * NOT write top-level files like `~/.olane/os.pid`; that pattern was a
 * pre-package implementation detail.
 */
export class OlaneOSManager {
  private readonly options: OlaneOSManagerOptions;

  constructor(options: OlaneOSManagerOptions) {
    if (!options.instanceName) {
      throw new Error('OlaneOSManager requires `instanceName`');
    }
    this.options = options;
  }

  /**
   * Start the OS as a detached background process. Idempotent: if an
   * instance with this name is already running, returns its info without
   * spawning a new child.
   */
  async start(): Promise<OsRunningInfo> {
    const existing = await this.status();
    if (existing.running && existing.info) {
      return existing.info;
    }

    const result = await startLocalOsInstance({
      instanceName: this.options.instanceName,
      port: this.options.port,
      noIndexNetwork: this.options.noIndexNetwork ?? true,
      cliEntry: this.options.cliEntry,
      logsDir: this.options.logsDir,
      env: this.options.env,
    });

    if (!result.alive || !result.pid) {
      throw new Error(
        `Olane OS failed to start (instance=${this.options.instanceName}). Tail ${result.logFile} for details.`,
      );
    }

    return {
      pid: result.pid,
      port: result.port,
      peerId: result.peerId,
      alive: true,
    };
  }

  /** Best-effort liveness check. */
  async status(): Promise<OsStatus> {
    const status = await statusLocalOsInstance(this.options.instanceName);
    if (!status?.alive || !status.config?.pid) {
      return { running: false, info: null };
    }
    return {
      running: true,
      info: {
        pid: status.config.pid,
        port: status.config.port,
        peerId: status.config.peerId,
        alive: true,
      },
    };
  }

  /** SIGTERM the running daemon. Returns `true` if something was stopped. */
  async stop(): Promise<boolean> {
    return stopLocalOsInstance(this.options.instanceName);
  }
}
