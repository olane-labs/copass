import type { ProjectConfig } from '@copass/core';

// -- File fingerprint --

export interface WatchFileState {
  mtimeMs: number;
  size: number;
  sha256: string;
  lastIndexedAt: string | null;
}

// -- Watch state --

export interface WatchHealthState {
  lastEventAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface WatchState extends WatchHealthState {
  version: 1;
  projectPath: string;
  files: Record<string, WatchFileState>;
}

// -- Events --

export type WatchEventType = 'add' | 'change' | 'unlink' | 'rename';

export interface FileSystemEventPayload {
  event: WatchEventType;
  path: string;
  oldPath?: string;
  timestamp: string;
  project_path: string;
}

// -- Diff operations --

export interface UpsertOperation {
  type: 'upsert';
  path: string;
  reason: 'added' | 'changed';
  fingerprint: WatchFileState;
}

export interface DeleteOperation {
  type: 'delete';
  path: string;
  fingerprint?: WatchFileState;
}

export interface RenameOperation {
  type: 'rename';
  oldPath: string;
  path: string;
  fingerprint: WatchFileState;
}

export interface DiffResult {
  upserts: UpsertOperation[];
  deletes: DeleteOperation[];
  renames: RenameOperation[];
  unchanged: string[];
}

// -- Runtime options --

export interface WatchRuntimeOptions {
  projectPath: string;
  config?: ProjectConfig;
  service?: boolean;
  once?: boolean;
  maxFiles?: number;
  /** Sandbox to ingest into. Required. */
  sandboxId: string;
  /** Storage project id. Optional — leave unset to ingest into the sandbox's default project. */
  projectId?: string;
}

// -- Full index --

export interface FullIndexOptions {
  projectPath: string;
  config?: ProjectConfig;
  maxFiles?: number;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
  /** Sandbox to ingest into. Required. */
  sandboxId: string;
  /** Storage project id. If omitted, a new sandbox-scoped project is created. */
  projectId?: string;
}

export interface FullIndexSummary {
  file_count: number;
  indexed_count: number;
  error_count: number;
  skipped_count: number;
  duration_ms: number;
  errors: Array<{ file: string; error: string }>;
}

// -- Watch service --

export type SupportedPlatform = 'darwin' | 'linux' | 'win32';

export interface WatchServiceDefinition {
  serviceId: string;
  platform: SupportedPlatform;
  projectPath: string;
  cliEntrypoint: string;
  descriptorPath: string;
  logDir: string;
}

export interface WatchServiceStatus {
  enabled: boolean;
  installed: boolean;
  running: boolean;
  serviceId: string;
  servicePlatform: SupportedPlatform;
  descriptorPath?: string;
  detail?: string;
}
