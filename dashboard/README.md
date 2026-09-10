# Job Intelligence dashboard

Private, read-only dashboard for the existing Germany opportunity-monitoring system. It is a separate Next.js process and does not replace or invoke any monitor, ranker, alert engine, history refresh, scheduler, backup, or database migration.

## Architecture

- Next.js 16 App Router with TypeScript and Tailwind CSS.
- Server Components query PostgreSQL directly; database data is never fetched from the browser with a connection string.
- PostgreSQL sessions set `default_transaction_read_only=on` and a five-second statement timeout.
- Each major dashboard section catches its own database error and renders a small fallback.
- Pages are server rendered. Normal refreshes are sufficient; there is no polling, websocket, chart library, queue, or client state framework.
- HTTP Basic authentication is enforced in `proxy.ts`. Production access must stay on localhost and travel through an SSH/IAP tunnel so the credentials are never sent over public clear-text HTTP.

No schema or view was added. Presentation labels such as **Apply now**, **Review**, **Future**, **Blocked**, and **Watch** are derived only from the existing `actionability_score`, `eligibility_status`, and stored blocker severities. They are not a new scoring model.

## Existing data used

| Dashboard area | Existing source of truth |
|---|---|
| Market metrics | `v_market_snapshot_latest` |
| Ranked opportunities | `opportunities`, `opportunity_rankings`, `employers` |
| Changes and closures | `opportunity_change_events` |
| Monitor activity | `monitoring_runs` |
| Source health | `monitored_sources`, `source_health_events` |
| Alert engine state | `alert_decisions`, `source_health_events` |
| Backups and restore checks | `production_backup_runs` |
| Digest freshness | `daily_digest_runs` |
| Lifecycle/detail context | existing opportunity and ranking JSON fields |

## Local run

Use Node.js 24.18.0 and npm 11.16.0.

```powershell
cd 'D:\German Database\dashboard'
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Set the values in `.env.local` first. When PostgreSQL is only available on the VM, open a separate SSH tunnel and set `PGHOST=127.0.0.1` and `PGPORT` to the local forwarded port. `.env.local` is ignored by Git.

Validation commands:

```powershell
npm run lint
npm run typecheck
npm run build
```

## Production plan (not executed)

1. Pull the reviewed commit onto the VM, or run the included installer from a trusted checkout:

   ```bash
   sudo dashboard/deploy-ubuntu.sh
   ```

   The installer creates a fresh immutable release under `/opt/faizan-dashboard/releases`, leaving the monitoring checkout untouched.
2. The installer creates a dedicated PostgreSQL login with `CONNECT`, `USAGE` on `public`, and `SELECT` on the existing tables/views only. It grants no mutation or schema privileges.
3. Create `/etc/faizan-dashboard/dashboard.env`, owned by `root` and readable only by the eventual dashboard service group. Set the environment names shown in `.env.example` with unique production values.
4. Run `npm ci` and `npm run build` in `dashboard/`.
5. Run the standalone Next.js server as an unprivileged user, bound to `127.0.0.1` only.
6. Access it with an authenticated SSH or Google Cloud IAP port tunnel. Do not open the dashboard port or PostgreSQL port in the public firewall.
7. The included `faizan-dashboard.service` runs only the dashboard. Existing monitor and backup timers remain untouched.

The application exposes no restart, run-monitor, delete, edit-environment, or database-write action.
