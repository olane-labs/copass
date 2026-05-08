/**
 * Body of the per-session agent daemon process.
 *
 * Front-ends with a hidden `_host` subcommand wire it to call this:
 *
 *   await runAgentDaemon({ kind, sessionId, user, ... });
 *
 * The function constructs an `AgentNode` from `@olane/o-agent`, points
 * its `leader` config at the running Olane OS host, opens a libp2p
 * listener so the leader can dial back through it, auto-registers with
 * `o://agents`, writes its session file, and stays resident until
 * SIGTERM.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { AGENT_KIND_METADATA, AgentNode } from '@olane/o-agent';
import type { AgentCard, AgentKind } from '@olane/o-agent';
import { oNodeAddress, oNodeTransport } from '@olane/o-node';
import { listOS } from '@olane/os';
import type { AgentDaemonOptions, SessionFile } from './types.js';
import { sessionFilePath, sessionsDir } from './paths.js';
import { OlaneOSNotRunningError } from './olane-client.js';

function addressFor(user: string, kind: string, sessionId: string): string {
  // Single-segment slug — multi-segment constructor addresses break
  // olane's cross-process registration handshake. See @olane/o-agent
  // README "Address scheme" for the full rationale.
  const safe = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  return `o://agent-${safe(user)}-${safe(kind)}-${safe(sessionId)}`;
}

async function resolveLeaderTransports(): Promise<{
  leaderAddress: string;
  transports: string[];
}> {
  const all = await listOS();
  const live = (all || []).filter(
    (entry) =>
      entry.alive && entry.config?.peerId && entry.config.transports?.length,
  );
  if (live.length === 0) {
    throw new OlaneOSNotRunningError(
      'Cannot start agent daemon: no Olane OS instance is running.',
    );
  }
  // Pick the most-recently-created instance — `OlaneOSInstanceConfig`
  // exposes `createdAt` (not `startedAt`); fall back to insertion order.
  const chosen = live.sort((a, b) => {
    const at = a.config.createdAt ? Date.parse(a.config.createdAt) : 0;
    const bt = b.config.createdAt ? Date.parse(b.config.createdAt) : 0;
    return bt - at;
  })[0];
  return {
    leaderAddress: 'o://leader',
    transports: chosen.config.transports!,
  };
}

export async function runAgentDaemon(
  options: AgentDaemonOptions,
): Promise<void> {
  await fsp.mkdir(options.sessionsDir || sessionsDir(), { recursive: true });

  const { leaderAddress, transports } = await resolveLeaderTransports();
  const address = addressFor(
    options.user,
    options.kind,
    options.sessionId,
  );

  const meta = AGENT_KIND_METADATA[options.kind as AgentKind];
  const skills = (
    options.skills && options.skills.length
      ? options.skills
      : meta?.defaultSkills || []
  ).map((id) => ({ id }));

  const card: AgentCard = {
    name: `${meta?.displayName || options.kind} session ${options.sessionId}`,
    description: options.description,
    url: address,
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills,
    olane: {
      kind: options.kind,
      sessionId: options.sessionId,
      user: options.user,
      registeringPid: process.pid,
      registeredAt: new Date().toISOString(),
    },
  };

  const leaderOAddress = new oNodeAddress(
    leaderAddress,
    transports.map((m) => new oNodeTransport(m)),
  );

  const agent = new AgentNode({
    address: new oNodeAddress(address) as any,
    leader: leaderOAddress as any,
    parent: leaderOAddress as any,
    // Cross-process daemons MUST listen — the leader dials back through
    // this port during routing. See @olane/o-agent README for the
    // full pattern.
    network: {
      listeners: ['/ip4/0.0.0.0/tcp/0'],
    },
    card,
  } as any);

  const sessionPath = sessionFilePath(options.sessionId);
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await agent.stop();
    } catch {
      /* best-effort */
    }
    try {
      await fsp.rm(sessionPath, { force: true });
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void cleanup());
  process.on('SIGINT', () => void cleanup());

  try {
    await agent.start();

    // After start(), the leader rewrites the address into its own
    // hierarchy (e.g. `o://leader/agent-...`). Persist the post-start
    // canonical address so the broker can dial it back.
    const effectiveAddress = (agent as any).address.toString();
    const sessionFile: SessionFile = {
      address: effectiveAddress,
      card: { ...card, url: effectiveAddress },
      pid: process.pid,
      startedAt: new Date().toISOString(),
      logFile: '',
    };
    await fsp.writeFile(
      sessionPath,
      JSON.stringify(sessionFile, null, 2),
      'utf8',
    );

    process.stdin.resume?.();
  } catch (e) {
    console.error('runAgentDaemon failed:', e);
    try {
      await fsp.rm(sessionPath, { force: true });
    } catch {
      /* ignore */
    }
    process.exit(1);
  }
}
