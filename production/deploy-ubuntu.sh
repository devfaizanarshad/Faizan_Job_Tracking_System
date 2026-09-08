#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run as root.' >&2; exit 1; fi
SOURCE_DIR=${1:-$(pwd)}
BOOTSTRAP_BACKUP=${2:-}
APP_ROOT=/opt/faizan-monitor/current
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-client rsync logrotate ca-certificates sudo
if ! command -v node >/dev/null || [[ $(node -p 'Number(process.versions.node.split(".")[0])') -lt 20 ]]; then
  echo 'Install supported Node.js 22 LTS, then rerun deployment.' >&2; exit 1
fi
id -u faizan-monitor >/dev/null 2>&1 || useradd --system --home /var/lib/faizan-monitor --shell /usr/sbin/nologin faizan-monitor
usermod -a -G faizan-monitor postgres
install -d -o root -g faizan-monitor -m 0750 /opt/faizan-monitor /etc/faizan-monitor
install -d -o faizan-monitor -g faizan-monitor -m 0750 /var/lib/faizan-monitor/{reports,exports,tmp}
install -d -o faizan-monitor -g faizan-monitor -m 0770 /var/log/faizan-monitor
install -d -o postgres -g faizan-monitor -m 0750 /var/backups/faizan-monitor
rsync -a --delete --exclude node_modules --exclude exports --exclude backups --exclude logs --exclude tmp --exclude '*.env' "$SOURCE_DIR/" "$APP_ROOT/"
chown -R root:faizan-monitor /opt/faizan-monitor
find /opt/faizan-monitor -type d -exec chmod 0750 {} +
find /opt/faizan-monitor -type f -exec chmod 0640 {} +
chmod 0750 "$APP_ROOT"/production/*.sh
npm --prefix "$APP_ROOT/monitor" ci --omit=dev
chown -R root:faizan-monitor "$APP_ROOT/monitor/node_modules"
if [[ ! -f /etc/faizan-monitor/faizan.env ]]; then
  install -o root -g faizan-monitor -m 0640 "$APP_ROOT/config/production.example.env" /etc/faizan-monitor/faizan.env
  echo 'Created /etc/faizan-monitor/faizan.env. Replace placeholder password and rerun.' >&2; exit 2
fi
if grep -q 'REPLACE_WITH_' /etc/faizan-monitor/faizan.env; then echo 'Configure secrets in /etc/faizan-monitor/faizan.env and rerun.' >&2; exit 2; fi
set -a; source /etc/faizan-monitor/faizan.env; set +a
export APP_DB_USER=${PGUSER} APP_DB_NAME=${PGDATABASE} APP_DB_PASSWORD=${PGPASSWORD} PGADMINHOST=/var/run/postgresql PGADMINUSER=postgres PGADMINPASSWORD=
sudo -u postgres --preserve-env=APP_DB_USER,APP_DB_NAME,APP_DB_PASSWORD,PGADMINHOST,PGPORT,PGADMINUSER node "$APP_ROOT/monitor/setup-production-db.js"
if [[ -n "$BOOTSTRAP_BACKUP" ]]; then sudo -u postgres pg_restore --exit-on-error --no-owner --no-privileges -d "$PGDATABASE" "$BOOTSTRAP_BACKUP"; fi
sudo -u postgres --preserve-env=FAIZAN_APP_ROOT,PGADMINHOST,PGPORT,PGDATABASE,PGADMINUSER node "$APP_ROOT/monitor/migrate-production.js"
sudo -u postgres --preserve-env=APP_DB_USER,APP_DB_NAME,APP_DB_PASSWORD,PGADMINHOST,PGPORT,PGADMINUSER node "$APP_ROOT/monitor/setup-production-db.js"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -c "ALTER SYSTEM SET listen_addresses='localhost';"
install -o root -g root -m 0644 "$APP_ROOT"/production/systemd/* /etc/systemd/system/
install -o root -g root -m 0644 "$APP_ROOT/production/logrotate/faizan-monitor" /etc/logrotate.d/faizan-monitor
systemctl daemon-reload
systemctl enable --now postgresql faizan-monitor-s.timer faizan-monitor-a.timer faizan-backup.timer faizan-backup-restore-verify.timer faizan-health.timer faizan-cleanup.timer
systemctl restart postgresql
sudo -u faizan-monitor --preserve-env=FAIZAN_APP_ROOT,FAIZAN_CONFIG_DIR,FAIZAN_LOG_DIR,FAIZAN_REPORT_DIR,FAIZAN_BACKUP_DIR,FAIZAN_EXPORT_DIR,FAIZAN_TEMP_DIR,PGHOST,PGPORT,PGDATABASE,PGUSER,PGPASSWORD node "$APP_ROOT/monitor/health-check.js" || true
echo 'Deployment preparation installed. Inspect health output and systemctl list-timers before relying on scheduling.'
