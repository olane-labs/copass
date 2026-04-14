/**
 * Background watch service management.
 *
 * Installs, uninstalls, and queries the status of platform-specific
 * background services (launchd on macOS, systemd on Linux, schtasks on Windows).
 */

import * as crypto from 'node:crypto';
import { accessSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import type { SupportedPlatform, WatchServiceDefinition, WatchServiceStatus } from '../types.js';
import { renderLaunchdPlist, renderSystemdUnit, buildWindowsTaskCommand } from './platforms.js';

function detectPlatform(): SupportedPlatform {
  const platform = os.platform();
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') return platform;
  return 'linux'; // fallback
}

function hashProjectPath(projectPath: string): string {
  return crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 12);
}

/** Generate a unique service ID for a project. */
export function buildWatchServiceId(projectPath: string, platform?: SupportedPlatform): string {
  const hash = hashProjectPath(projectPath);
  const p = platform ?? detectPlatform();
  return p === 'darwin' ? `com.olane.watch.${hash}` : `olane-watch-${hash}`;
}

/** Build a full service definition for a project. */
export function buildWatchServiceDefinition(
  projectPath: string,
  cliEntrypoint: string,
  platform?: SupportedPlatform,
): WatchServiceDefinition {
  const p = platform ?? detectPlatform();
  const serviceId = buildWatchServiceId(projectPath, p);
  const logDir = path.join(projectPath, '.olane', 'logs');

  let descriptorPath: string;
  switch (p) {
    case 'darwin':
      descriptorPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${serviceId}.plist`);
      break;
    case 'linux':
      descriptorPath = path.join(os.homedir(), '.config', 'systemd', 'user', `${serviceId}.service`);
      break;
    case 'win32':
      descriptorPath = ''; // Windows uses registry, no descriptor file
      break;
  }

  return { serviceId, platform: p, projectPath, cliEntrypoint, descriptorPath, logDir };
}

/** Install and start the background watch service. */
export async function installWatchService(
  projectPath: string,
  cliEntrypoint: string,
  platform?: SupportedPlatform,
): Promise<WatchServiceStatus> {
  const def = buildWatchServiceDefinition(projectPath, cliEntrypoint, platform);
  await fs.mkdir(def.logDir, { recursive: true });

  switch (def.platform) {
    case 'darwin': {
      const plist = renderLaunchdPlist(def);
      await fs.mkdir(path.dirname(def.descriptorPath), { recursive: true });
      await fs.writeFile(def.descriptorPath, plist);
      try {
        execSync(`launchctl bootout gui/$(id -u) ${def.descriptorPath} 2>/dev/null || true`);
      } catch { /* not loaded yet */ }
      execSync(`launchctl bootstrap gui/$(id -u) ${def.descriptorPath}`);
      break;
    }
    case 'linux': {
      const unit = renderSystemdUnit(def);
      await fs.mkdir(path.dirname(def.descriptorPath), { recursive: true });
      await fs.writeFile(def.descriptorPath, unit);
      execSync('systemctl --user daemon-reload');
      execSync(`systemctl --user enable ${def.serviceId}`);
      execSync(`systemctl --user start ${def.serviceId}`);
      break;
    }
    case 'win32': {
      const cmd = buildWindowsTaskCommand(def);
      execSync(cmd);
      break;
    }
  }

  return getWatchServiceStatus(projectPath, cliEntrypoint, def.platform);
}

/** Uninstall the background watch service. */
export async function uninstallWatchService(
  projectPath: string,
  cliEntrypoint: string,
  platform?: SupportedPlatform,
): Promise<void> {
  const def = buildWatchServiceDefinition(projectPath, cliEntrypoint, platform);

  switch (def.platform) {
    case 'darwin':
      try {
        execSync(`launchctl bootout gui/$(id -u) ${def.descriptorPath} 2>/dev/null`);
      } catch { /* not loaded */ }
      try { await fs.unlink(def.descriptorPath); } catch { /* already gone */ }
      break;
    case 'linux':
      try {
        execSync(`systemctl --user stop ${def.serviceId} 2>/dev/null`);
        execSync(`systemctl --user disable ${def.serviceId} 2>/dev/null`);
      } catch { /* not active */ }
      try { await fs.unlink(def.descriptorPath); } catch { /* already gone */ }
      execSync('systemctl --user daemon-reload');
      break;
    case 'win32':
      try { execSync(`schtasks /delete /tn "${def.serviceId}" /f`); } catch { /* not found */ }
      break;
  }
}

/** Check the status of the background watch service. */
export function getWatchServiceStatus(
  projectPath: string,
  cliEntrypoint: string,
  platform?: SupportedPlatform,
): WatchServiceStatus {
  const def = buildWatchServiceDefinition(projectPath, cliEntrypoint, platform);
  let installed = false;
  let running = false;

  switch (def.platform) {
    case 'darwin':
      try {
        accessSync(def.descriptorPath);
        installed = true;
      } catch { /* not installed */ }
      if (installed) {
        try {
          const output = execSync(`launchctl print gui/$(id -u)/${def.serviceId} 2>/dev/null`, { encoding: 'utf-8' });
          running = output.includes('state = running');
        } catch { /* not running */ }
      }
      break;
    case 'linux':
      try {
        accessSync(def.descriptorPath);
        installed = true;
      } catch { /* not installed */ }
      if (installed) {
        try {
          const output = execSync(`systemctl --user is-active ${def.serviceId} 2>/dev/null`, { encoding: 'utf-8' });
          running = output.trim() === 'active';
        } catch { /* not running */ }
      }
      break;
    case 'win32':
      try {
        execSync(`schtasks /query /tn "${def.serviceId}" 2>nul`, { encoding: 'utf-8' });
        installed = true;
        running = true; // schtasks doesn't distinguish well
      } catch { /* not found */ }
      break;
  }

  return {
    enabled: true,
    installed,
    running,
    serviceId: def.serviceId,
    servicePlatform: def.platform,
    descriptorPath: def.descriptorPath || undefined,
  };
}
