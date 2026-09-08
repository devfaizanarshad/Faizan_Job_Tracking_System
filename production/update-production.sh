#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run as root.' >&2; exit 1; fi
SOURCE_DIR=${1:?Usage: update-production.sh SOURCE_DIR}
APP_ROOT=/opt/faizan-monitor/current
systemctl start faizan-backup-restore-verify.service
systemctl stop faizan-monitor-s.timer faizan-monitor-a.timer
ROLLBACK=/opt/faizan-monitor/rollback-$(date -u +%Y%m%dT%H%M%SZ)
cp -a "$APP_ROOT" "$ROLLBACK"
trap 'echo "Update failed. Code retained at '"$ROLLBACK"'. Follow RUNBOOK.md rollback procedure." >&2' ERR
rsync -a --delete --exclude node_modules --exclude exports --exclude backups --exclude logs --exclude tmp --exclude '*.env' "$SOURCE_DIR/" "$APP_ROOT/"
chown -R root:faizan-monitor "$APP_ROOT"
npm --prefix "$APP_ROOT/monitor" ci --omit=dev
chown -R root:faizan-monitor "$APP_ROOT/monitor/node_modules"
set -a; source /etc/faizan-monitor/faizan.env; set +a
export PGADMINHOST=/var/run/postgresql PGADMINUSER=postgres PGADMINPASSWORD=
sudo -u postgres --preserve-env=FAIZAN_APP_ROOT,PGADMINHOST,PGPORT,PGDATABASE,PGADMINUSER node "$APP_ROOT/monitor/migrate-production.js"
sudo -u faizan-monitor --preserve-env=PGHOST,PGPORT,PGDATABASE,PGUSER,PGPASSWORD npm --prefix "$APP_ROOT/monitor" run test:phase2c
sudo -u faizan-monitor --preserve-env=PGHOST,PGPORT,PGDATABASE,PGUSER,PGPASSWORD npm --prefix "$APP_ROOT/monitor" run test:phase2d
sudo -u faizan-monitor --preserve-env=PGHOST,PGPORT,PGDATABASE,PGUSER,PGPASSWORD npm --prefix "$APP_ROOT/monitor" run test:phase2e
systemctl start faizan-monitor-s.timer faizan-monitor-a.timer
sudo -u faizan-monitor --preserve-env=FAIZAN_APP_ROOT,FAIZAN_LOG_DIR,FAIZAN_REPORT_DIR,FAIZAN_BACKUP_DIR,PGHOST,PGPORT,PGDATABASE,PGUSER,PGPASSWORD node "$APP_ROOT/monitor/health-check.js" || true
trap - ERR
