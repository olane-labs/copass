/**
 * Platform-specific service descriptor renderers.
 */

import type { WatchServiceDefinition } from '../types.js';

/** Render a macOS launchd plist XML. */
export function renderLaunchdPlist(def: WatchServiceDefinition): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${def.serviceId}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${def.cliEntrypoint}</string>
    <string>watch</string>
    <string>--service</string>
    <string>${def.projectPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${def.logDir}/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${def.logDir}/stderr.log</string>
</dict>
</plist>`;
}

/** Render a Linux systemd unit file. */
export function renderSystemdUnit(def: WatchServiceDefinition): string {
  return `[Unit]
Description=Copass Watch Service (${def.projectPath})
After=network.target

[Service]
Type=simple
ExecStart=${def.cliEntrypoint} watch --service ${def.projectPath}
Restart=on-failure
RestartSec=10
StandardOutput=append:${def.logDir}/stdout.log
StandardError=append:${def.logDir}/stderr.log

[Install]
WantedBy=default.target`;
}

/** Build a Windows schtasks command string. */
export function buildWindowsTaskCommand(def: WatchServiceDefinition): string {
  const args = `watch --service "${def.projectPath}"`;
  return `schtasks /create /tn "${def.serviceId}" /tr "${def.cliEntrypoint} ${args}" /sc onlogon /rl limited /f`;
}
