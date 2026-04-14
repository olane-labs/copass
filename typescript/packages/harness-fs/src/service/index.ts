export {
  buildWatchServiceId,
  buildWatchServiceDefinition,
  installWatchService,
  uninstallWatchService,
  getWatchServiceStatus,
} from './manager.js';
export { renderLaunchdPlist, renderSystemdUnit, buildWindowsTaskCommand } from './platforms.js';
