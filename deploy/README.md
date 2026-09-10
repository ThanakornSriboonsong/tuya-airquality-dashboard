# Deploying the rig

One Ubuntu 24.04 VPS (2 GB RAM — `next build` OOMs on 1 GB — 40 GB disk) running
two Node processes behind Caddy. No Docker.

The poller talks to **Tuya's cloud API**, not to the sensors over the LAN, so the
box does not need to be anywhere near the devices.

```
browser ──HTTPS──► Caddy :443  (basic auth, TLS, single origin)
                     ├── /api/*  ──► 127.0.0.1:3001   backend (poller + REST)
                     └── /*      ──► 127.0.0.1:3000   web
                                          │
                              /srv/airquality/data/readings.sqlite
```

Both Node processes bind to loopback. This is load-bearing: if the backend listened
on `0.0.0.0:3001` the API would be reachable directly and the login in front of the
dashboard would protect nothing.

## 1. Provision

```bash
# as root
adduser --system --group --home /srv/airquality airquality
apt update && apt install -y build-essential python3 git sqlite3 ufw caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
corepack enable && corepack prepare pnpm@10.12.4 --activate
timedatectl set-timezone UTC
ufw allow 22,80,443/tcp && ufw enable
```

`build-essential` and `python3` are required: `better-sqlite3` is a native module and
compiles during install. **`node_modules` cannot be copied from the Windows dev box.**

```bash
git clone <repo> /srv/airquality
chown -R airquality:airquality /srv/airquality
```

## 2. Configure

Create `/srv/airquality/.env` from `.env.example` (mode `600`, owned by `airquality`)
with the real Tuya credentials plus:

```
DB_PATH=/srv/airquality/data/readings.sqlite
PORT=3001
POLL_INTERVAL_MS=60000
```

`DB_PATH` must be **absolute** so it never depends on the working directory.

## 3. Move the existing database across

The dev box keeps most recent readings in a `-wal` file beside the `.sqlite`.
Copying `readings.sqlite` alone loses them. With the dev backend **stopped**:

```bash
# on Windows, from apps/backend
node -e "const D=require('better-sqlite3');const d=new D('../../data/readings.sqlite');d.exec(\"VACUUM INTO '../../data/seed.sqlite'\")"
```

`scp data/seed.sqlite` to `/srv/airquality/data/readings.sqlite`, then
`chown airquality:airquality` it and check the row count survived:

```bash
sqlite3 /srv/airquality/data/readings.sqlite 'select count(*), min(ts), max(ts) from readings'
```

## 4. Build and install services

```bash
sudo -u airquality bash -c 'cd /srv/airquality && pnpm install --frozen-lockfile \
  && pnpm --filter @tuya-dashboard/shared build \
  && NEXT_PUBLIC_API_URL=/api pnpm build \
  && pnpm --filter backend db:migrate'

cp /srv/airquality/deploy/airquality-*.service /srv/airquality/deploy/airquality-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now airquality-backend airquality-web airquality-backup.timer
```

Put your domain and a `caddy hash-password` hash into `deploy/Caddyfile`, then:

```bash
cp /srv/airquality/deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy
```

## Updating

`sudo -u airquality /srv/airquality/deploy/update.sh` — backs up, pulls, rebuilds,
migrates, restarts, in that order.

## Backups

`deploy/backup.sh` runs daily at 03:15 UTC and keeps 14 days in
`data/backups/`. It uses `VACUUM INTO`, which is safe against the live database.
**Never back up by copying `readings.sqlite`** — in WAL mode that omits every
un-checkpointed write.

14 local dailies don't survive losing the VPS. Add an off-box copy (`rclone`/`scp`
of the newest file) on the same schedule.

## Verification

1. `systemctl status airquality-backend airquality-web` — both `active (running)`.
2. `journalctl -u airquality-backend -f` — `Tuya client configured for …`, then
   `Wrote N reading(s).` within a poll interval. No `Poll failed` lines.
3. `ss -ltnp | grep -E '3000|3001'` — both must show `127.0.0.1:`, not `0.0.0.0:`.
4. `curl -I https://rig.example.com` → `401`; with `-u` → the dashboard.
   `curl -u … https://rig.example.com/api/readings/latest` → JSON for both devices.
5. From off-box, `curl --max-time 5 http://<ip>:3001/devices` must refuse or time out.
6. Log in from a browser: indoor vs outdoor PM2.5 renders, timestamps are recent.
7. `select count(*), min(ts), max(ts) from readings` — continuous with the dev data,
   no duplicates.
8. Run `deploy/backup.sh` by hand; check the snapshot's row count matches live.
9. Reboot the box and re-check step 1 — proves it survives an unattended restart.

## Notes

The Python notebooks in `analysis/` read the database directly. Open it read-only —
`sqlite3.connect("file:/srv/airquality/data/readings.sqlite?mode=ro", uri=True)` — so
a notebook can never take a write lock on the file the poller depends on.

## Note on the frontend API base

`NEXT_PUBLIC_API_URL=/api` is read from the **shell environment during `pnpm build`**
and inlined into the JS bundle; it is not read at runtime. A shell variable takes
precedence over any `.env` file, so the dev-only `apps/web/.env.local`
(`http://localhost:3001`, gitignored) cannot leak into a production build.

After building, confirm the right value was baked in:

```bash
grep -rho "fetch(`[^`]*`" apps/web/.next/static/chunks/*.js | head -1
# expect: fetch(`/api${e}`   — not a localhost or absolute URL
```
