# Application deployment preparation

This document covers application installation only. It does not enable systemd, cron, PM2, Docker, Nginx, or any production timer.

## Runtime

- Node.js: exactly `24.18.0` (`.nvmrc`)
- npm: exactly `11.16.0`
- PostgreSQL server: migrated PostgreSQL 16 database
- Install directory: arbitrary; application paths are derived from the project root or `FAIZAN_*` environment variables

Install dependencies from the `monitor` directory with `npm ci`. Do not copy local `node_modules` to Linux.

## Existing entrypoints

From `monitor`:

- `npm run monitor -- --tiers=S --mode=MANUAL` — monitoring only
- `npm run automate -- --tiers=S --trigger=MANUAL` — monitoring, alerts/health, ranking, history, and digest
- `npm run rank` — Phase 2D ranking refresh
- `npm run history` — Phase 2E historical refresh
- `npm run alerts -- --run-id=RUN_ID` — alert/source-health processing for a monitoring run
- `npm run digest` — daily digest only
- `npm run test:phase2c`, `npm run test:phase2d`, `npm run test:phase2e` — regression suites

The validated manual production entrypoint is `npm run automate -- --tiers=S --trigger=MANUAL`. Do not use `--force` for normal execution.

## Environment

Use the names in `config/application.example.env`. A populated `.env` is local-only and ignored by Git. The application does not automatically load `.env`; export variables through the shell or a future service manager. With `NODE_ENV=production`, all five PostgreSQL variables are mandatory and missing values fail before a connection is attempted.

`TZ=Europe/Berlin` makes human-readable timestamps consistent on Linux. Digest day boundaries continue to use the timezone stored in `monitoring_profile`.

## Manual VM smoke check

```bash
nvm install 24.18.0
nvm use 24.18.0
cd /path/to/repository/monitor
npm ci
set -a
source /secure/path/application.env
set +a
npm run test:phase2c
npm run test:phase2d
npm run test:phase2e
npm run automate -- --tiers=S --trigger=MANUAL
```

External email, Telegram, and desktop delivery remain disabled. Scheduling is intentionally not configured in this preparation phase.
