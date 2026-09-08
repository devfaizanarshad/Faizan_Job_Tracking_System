import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const appRoot=path.resolve(process.env.FAIZAN_APP_ROOT||moduleRoot);
export const runtimePaths=Object.freeze({
  appRoot,
  configDir:path.resolve(process.env.FAIZAN_CONFIG_DIR||path.join(appRoot,'config')),
  logDir:path.resolve(process.env.FAIZAN_LOG_DIR||path.join(appRoot,'logs')),
  reportDir:path.resolve(process.env.FAIZAN_REPORT_DIR||path.join(appRoot,'reports')),
  backupDir:path.resolve(process.env.FAIZAN_BACKUP_DIR||path.join(appRoot,'backups')),
  exportDir:path.resolve(process.env.FAIZAN_EXPORT_DIR||path.join(appRoot,'exports')),
  tempDir:path.resolve(process.env.FAIZAN_TEMP_DIR||path.join(appRoot,'tmp'))
});
