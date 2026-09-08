# Production deployment and recovery runbook

## Architecture and filesystem

Use Ubuntu 24.04 LTS, Node.js 22 LTS, and the Ubuntu-supported PostgreSQL release (16 or newer). The deployment is provider-neutral and needs no inbound web endpoint.

| Path | Owner/mode | Purpose |
|---|---|---|
| `/opt/faizan-monitor/current` | `root:faizan-monitor` 0750 | immutable application code |
| `/etc/faizan-monitor/faizan.env` | `root:faizan-monitor` 0640 | environment secrets/configuration |
| `/var/lib/faizan-monitor/reports` | `faizan-monitor` 0750 | generated reports and alerts |
| `/var/lib/faizan-monitor/exports` | `faizan-monitor` 0750 | temporary exports |
| `/var/lib/faizan-monitor/tmp` | `faizan-monitor` 0750 | disposable working files |
| `/var/log/faizan-monitor` | `faizan-monitor` 0770 | structured JSONL logs |
| `/var/backups/faizan-monitor` | `postgres:faizan-monitor` 0750 | database archives |

The local Windows installation and Phase 2E backup remain untouched and form the recovery source. Production runtime code uses environment-derived, platform-neutral paths.

## Initial deployment

1. Create an Ubuntu VM with at least 2 GB RAM and 20 GB storage. Restrict SSH to a trusted IP or VPN.
2. Install Node.js 22 LTS from its signed distribution packages.
3. Copy this project and the verified Phase 2E custom backup to the VM.
4. Run `sudo production/deploy-ubuntu.sh /path/to/source`. The first invocation creates `/etc/faizan-monitor/faizan.env` and stops.
5. Generate a unique password of at least 24 characters, edit the environment file, and keep email/Telegram flags false.
6. Rerun with the bootstrap archive: `sudo production/deploy-ubuntu.sh /path/to/source /secure/path/faizan_employer_intelligence_phase2e_2026-09-04.backup`.
7. Inspect `systemctl list-timers 'faizan-*'`, `journalctl -u 'faizan-*'`, and run the health command.

The deploy script is idempotent. Do not pass the bootstrap archive after the database has been populated. Migrations are deterministic and safe to rerun.

## PostgreSQL security

PostgreSQL binds to localhost. Port 5432 must not be allowed by the cloud firewall. The `faizan_monitor` application role is login-only, non-superuser, cannot create databases/roles, and receives CRUD rights only on application tables and sequences. Schema migrations and restore verification run locally as the `postgres` operating-system account through peer authentication. Confirm `pg_hba.conf` permits local peer administration and password authentication only from `127.0.0.1/32` for the application role. UTF-8 is enforced at database creation and PostgreSQL starts through systemd.

## Scheduling and failures

Tier S runs at 00:00, 08:00, and 16:00; Tier A at 06:00 and 18:00. Five-minute randomized delay prevents synchronized external load without changing frequency. Timers are persistent after reboot. Both orchestration and monitoring PostgreSQL advisory locks prevent overlap. A failed source is recorded and isolated; the loop continues. Existing history is retained, with removal only after two successful listing misses. Source backoff is exponential up to 72 hours and honors numeric `Retry-After`.

Systemd restarts timers after VM/PostgreSQL restart. Oneshoot jobs are retried at the next timer event; no aggressive retry loop is configured. Database/network/process failures produce non-zero status, database execution records where possible, journald output, and redacted JSONL logs.

## Logging, health, and retention

Run `sudo -u faizan-monitor -g faizan-monitor bash -c 'set -a; source /etc/faizan-monitor/faizan.env; node /opt/faizan-monitor/current/monitor/health-check.js'`. It reports `HEALTHY`, `DEGRADED`, or `UNHEALTHY` and includes scheduler freshness, last S/A success, database reachability/size, source failures, digest and backup freshness, alert-engine availability, disk usage, directory sizes, memory, and process RSS—never secrets.

Logrotate rotates JSONL daily or at 20 MB, retains 14 compressed generations, and journald uses the host's bounded policy. Reports retain 90 days, exports 30 days, temporary files 1 day, backups 14 days, and compressed logs 30 days. Review these values against disk capacity. No Redis, containers, queue, or orchestration platform is required.

## Backup and restore

Daily backups run at 03:30 and are accepted only after `pg_restore --list` succeeds. Every Sunday a separate backup is fully restored to a uniquely named temporary database, verifies at least 74 canonical lifecycles, and is dropped. Each run records bytes, SHA-256, archive-list verification, restore verification, and errors in `production_backup_runs`. Never call an archive fully restore-verified when only the archive list passed.

Manual full verification: `sudo systemctl start faizan-backup-restore-verify.service`, then inspect `journalctl -u faizan-backup-restore-verify.service` and `production_backup_runs`. Restore to a new database with `createdb target`, `pg_restore --exit-on-error --no-owner --no-privileges -d target archive.backup`, apply migrations, verify counts/views, and only then change application configuration. Never overwrite the damaged database during recovery.

Optional future off-server storage may copy completed `.backup` files and SHA-256 metadata to an encrypted S3-compatible bucket with versioning and lifecycle rules. It is not required or configured now.

## Safe update and rollback

The update sequence is: full restore-verified backup → stop timers → preserve current code → copy new code → `npm ci` → migrations → Phase 2C/2D/2E regression tests → restart timers → health check. Run `sudo production/update-production.sh /path/to/new/source`.

On failure, leave timers stopped. Restore `/opt/faizan-monitor/current` from the timestamped rollback copy. If a migration is incompatible, create a new database from the pre-update verified archive; do not reverse-mutate the historical database. Point the environment to the restored database, start timers, and run health. Retain the failed database for diagnosis.

## Firewall and remaining cloud steps

Inbound: allow SSH TCP/22 only from a trusted IP/VPN; allow no public 5432 and no HTTP/HTTPS. Outbound: allow DNS, HTTPS/443 for official career sources and OS updates, and required time synchronization. Then select a provider, create the VM and disk, attach firewall rules, install the signed Node package, transfer code/backup securely, configure DNS/NTP monitoring if desired, run deployment, and verify timers/health. No dashboard or public endpoint belongs in Phase 2F.
