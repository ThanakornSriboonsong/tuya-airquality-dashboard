#!/usr/bin/env bash
# Pull, rebuild, migrate, restart. Run as the airquality user on the box.
set -euo pipefail

cd /srv/airquality

# Back up before anything can touch the schema.
./deploy/backup.sh

git pull

# Full install, not --prod: drizzle-kit is a devDependency and we need it to
# migrate. better-sqlite3 is native and recompiles here if Node changed.
pnpm install --frozen-lockfile

# Shared must be built first — both apps import it from its dist/.
pnpm --filter @tuya-dashboard/shared build

# NEXT_PUBLIC_API_URL is inlined at BUILD time, not read at runtime. The
# relative /api keeps the box's hostname out of the bundle.
NEXT_PUBLIC_API_URL=/api pnpm build

# Migrate before restarting so new code never meets an old schema.
pnpm --filter backend db:migrate

sudo systemctl restart airquality-backend airquality-web
echo "deployed; check: journalctl -u airquality-backend -n 50"
