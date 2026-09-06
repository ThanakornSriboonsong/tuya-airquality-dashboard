# Air Quality Test Rig

## What this is

A measurement instrument, not a product. It exists to evaluate whether an air
purifier works, by comparing PM2.5 indoors (room with purifier) against outdoors,
and by measuring particle decay curves during controlled runs.

**Data integrity beats features.** A missing feature costs an afternoon. Corrupted
or silently-wrong data costs a week of testing and may not be detectable after the
fact. When in doubt, fail loudly and write nothing.

## Stack

- TypeScript everywhere
- **Backend**: NestJS — one process running both the poller (`@nestjs/schedule`)
  and the REST API
- **Tuya**: `@tuya/tuya-connector-nodejs` (handles HMAC signing + token refresh).
  Wrap it behind our own `TuyaClientService`. Use its generic `context.request()`
  for endpoints it doesn't cover.
- **DB**: SQLite via `better-sqlite3`, WAL mode. Schema/queries via Drizzle ORM.
- **Frontend**: Next.js App Router + Tailwind + TanStack Query
- **Charts**: Recharts (switch to uPlot only if performance demands it)
- **Analysis**: Python + pandas notebooks in `analysis/`, reading the SQLite file directly
- **Deploy**: single box, systemd or pm2. No Docker.

## Layout

```
apps/backend/     Nest: poller + REST API
apps/web/         Next.js
packages/shared/  metric enums, DTOs, AQI breakpoints
analysis/         Python notebooks
data/readings.sqlite
```

pnpm workspaces. Types shared between backend and web MUST live in
`packages/shared` — never duplicated.

## Schema

```sql
devices(id TEXT PK, label TEXT, placement TEXT, room_volume_m3 REAL)
  -- placement: 'indoor' | 'outdoor'
device_metrics(device_id, dp_code, metric, unit, scale INTEGER)
readings(ts INTEGER, device_id TEXT, metric TEXT, value REAL)
calibration(device_id, metric, slope REAL, intercept REAL, fitted_at, valid_from)
events(ts INTEGER, kind TEXT, note TEXT)
runs(id, label, started_at, ended_at, condition TEXT, fan_speed TEXT, notes TEXT)
  -- condition: 'purifier_on' | 'purifier_off_control' | 'passive'
```

Index on `readings(device_id, metric, ts)`.

## Hard rules

1. **Never hardcode DP codes or scale factors.** They come from
   `/v1.0/devices/{id}/specifications` and are seeded into `device_metrics`.
   Different sensor models expose different codes.
2. **Store raw values.** Apply calibration and scale at read time, not write time.
   The calibration fit will be revised; the raw data must survive that.
3. **Use the device-reported timestamp**, not the poll time. Tuya's status endpoint
   returns the last value the device pushed, which may be minutes old.
4. **Skip unchanged readings.** If the device hasn't reported since the last poll,
   the same timestamp comes back. Don't insert duplicates.
5. **Never write a stale or guessed value on error.** Retry with backoff, log the
   failure, and leave a gap. A visible gap is recoverable; fabricated data is not.
6. **Store PM2.5 as raw µg/m³.** AQI is computed at the API layer so the standard
   (US EPA vs national) is a single swappable constant.

## Commands

```bash
pnpm dev              # both apps
pnpm --filter backend dev
pnpm --filter web dev
pnpm db:generate      # drizzle migration from schema
pnpm db:migrate
pnpm test
```

## Out of scope — do not build

Auth, multi-user, Docker, Pulsar/real-time push, alerting, dark mode,
mobile-responsive beyond "doesn't break". These come after we have results.

## Working style

- Small commits, one concern each.
- Ask before adding a dependency that isn't listed above.
- The poller is the most safety-critical code in the repo. It gets tests.
- Prefer boring, readable code over clever abstractions. Two devices, one room.

## Current phase

<!-- Update this as you go. -->
Phase 1 done: device registration (discover → map DP codes → seed
`devices`/`device_metrics`), poller (raw values, device-reported timestamps,
dedup, backoff-on-error), readings API (scale + calibration applied at read
time, AQI), and a live dashboard (indoor vs outdoor PM2.5, device onboarding
UI). Two real devices registered and polling.

Next: controlled decay-curve runs (`runs`/`events` tables have no API yet),
calibration fitting UI (`calibration` table is read-ready but nothing writes
to it).
