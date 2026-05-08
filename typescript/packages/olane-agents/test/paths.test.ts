import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  olaneHome,
  sessionsDir,
  sessionFilePath,
  logsDir,
  sessionLogFile,
} from '../src/paths.js';

describe('paths', () => {
  let originalHome: string | undefined;
  beforeEach(() => {
    originalHome = process.env.OLANE_HOME;
  });
  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.OLANE_HOME;
    } else {
      process.env.OLANE_HOME = originalHome;
    }
  });

  it('defaults to ~/.olane', () => {
    delete process.env.OLANE_HOME;
    expect(olaneHome()).toBe(path.join(os.homedir(), '.olane'));
  });

  it('honors OLANE_HOME override', () => {
    process.env.OLANE_HOME = '/tmp/test-olane-home';
    expect(olaneHome()).toBe('/tmp/test-olane-home');
    expect(sessionsDir()).toBe('/tmp/test-olane-home/sessions');
    expect(sessionFilePath('abc-123')).toBe(
      '/tmp/test-olane-home/sessions/abc-123.json',
    );
    expect(logsDir()).toBe('/tmp/test-olane-home/logs');
    expect(sessionLogFile('abc-123')).toBe(
      '/tmp/test-olane-home/logs/session-abc-123.log',
    );
  });
});
