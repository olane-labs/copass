import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.js';

describe('@copass/olane-agents public surface', () => {
  it('exports OlaneOSManager class', () => {
    expect(typeof pkg.OlaneOSManager).toBe('function');
  });
  it('exports AgentBroker class', () => {
    expect(typeof pkg.AgentBroker).toBe('function');
  });
  it('exports runOlaneOSHost function', () => {
    expect(typeof pkg.runOlaneOSHost).toBe('function');
  });
  it('exports runAgentDaemon function', () => {
    expect(typeof pkg.runAgentDaemon).toBe('function');
  });
  it('exports withOlaneClient helper', () => {
    expect(typeof pkg.withOlaneClient).toBe('function');
  });
  it('exports OlaneOSNotRunningError class', () => {
    expect(typeof pkg.OlaneOSNotRunningError).toBe('function');
    const err = new pkg.OlaneOSNotRunningError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('OlaneOSNotRunningError');
  });
  it('exports paths helpers', () => {
    expect(typeof pkg.olaneHome).toBe('function');
    expect(typeof pkg.sessionsDir).toBe('function');
    expect(typeof pkg.sessionFilePath).toBe('function');
    expect(typeof pkg.logsDir).toBe('function');
    expect(typeof pkg.sessionLogFile).toBe('function');
  });
  it('does NOT re-export ConfigManager (F4 — consumers go to @olane/os directly)', () => {
    expect((pkg as any).ConfigManager).toBeUndefined();
  });
});

describe('OlaneOSManager constructor validation', () => {
  it('throws without instanceName', () => {
    expect(() => new pkg.OlaneOSManager({} as any)).toThrow(/instanceName/);
  });

  it('accepts a valid config', () => {
    const m = new pkg.OlaneOSManager({ instanceName: 'test' });
    expect(m).toBeInstanceOf(pkg.OlaneOSManager);
  });
});
