#!/usr/bin/env bash
# Backup drill: back up the rehearsal database with the project's own script (npm run backup), restore it into a fresh database, compare
# the row count of EVERY table (not only the ones scripts/backup.js checks), check that encrypted fields still decrypt with the same
# DATA_ENCRYPTION_KEY, start the app on the restored copy and ask it a few pages, run the money invariants on it, and time each step.
#   DATABASE_URL=postgresql://.../wisecall_rehearsal scripts/rehearsal/backup-drill.sh [target-db-name]
# Writes tests/load/results/backup-drill.json. Drops the target database first if it exists (it must contain "restore").
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC="$DATABASE_URL"
TARGET="${1:-wisecall_restore_drill}"
[[ "$TARGET" == *restore* ]] || { echo "the target database name must contain 'restore'"; exit 1; }
DST="${SRC%/*}/$TARGET"
ADMIN="${SRC%/*}/postgres"
ms() { date +%s%3N; }
OUT=tests/load/results; mkdir -p "$OUT"

T0=$(ms)
FILE=$(npm run -s backup -- "$SRC" | sed -n 's/^Saved \(.*\.dump\) (.*/\1/p')
T1=$(ms)
SIZE=$(stat -c %s "$FILE")
psql "$ADMIN" -qc "DROP DATABASE IF EXISTS $TARGET" -c "CREATE DATABASE $TARGET"
T2=$(ms)
pg_restore --no-owner --exit-on-error --dbname "$DST" "$FILE"
T3=$(ms)

# every table, exact counts, both sides
COUNTS_SQL="SELECT string_agg(t, ',' ORDER BY t) FROM (SELECT format('%s=%s', table_name, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', table_name), false, true, '')))[1]::text) AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') x"
SRC_COUNTS=$(psql "$SRC" -Atc "$COUNTS_SQL")
DST_COUNTS=$(psql "$DST" -Atc "$COUNTS_SQL")

# encrypted fields (payout IBANs) decrypt with this machine's key
DECRYPT=$(DATABASE_URL="$DST" node -e "
  require('dotenv').config(); const { Client } = require('pg'); const { decrypt } = require('./server/cryptoBox');
  (async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    const { rows } = await c.query('SELECT payout_iban_enc, payout_iban_last4 FROM users WHERE payout_iban_enc IS NOT NULL');
    let ok = 0; for (const r of rows) { try { if (decrypt(r.payout_iban_enc).endsWith(r.payout_iban_last4)) ok++; } catch (e) {} }
    console.log(ok + '/' + rows.length); await c.end(); })();")

# the app starts on the restored copy
T4=$(ms)
PORT=4310
( exec env DATABASE_URL="$DST" NODE_ENV=development PORT=$PORT PUBLIC_URL="http://localhost:$PORT" LAUNCH_MODE=live PAYMENT_PROVIDER=mock KYC_PROVIDER=mock \
    EMAIL_PROVIDER=log LIVE_PROVIDER=fake node scripts/rehearsal/server-prodlike.js ) > /tmp/wisecall-restore-drill.log 2>&1 &
APP=$!
UP=0; for i in $(seq 1 120); do if curl -fs "http://localhost:$PORT/healthz" >/dev/null 2>&1; then UP=1; break; fi; sleep 0.25; done
T5=$(ms)
PAGES=""
for P in / /ka/ /live /answers /api/experts "/u/rehearsal-mentor-3"; do PAGES="$PAGES $P=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$P" || true)"; done
kill $APP 2>/dev/null; wait $APP 2>/dev/null || true
INV=$(DATABASE_URL="$DST" node scripts/rehearsal/invariants.js | head -1)

node -e "
const parse = (s) => Object.fromEntries(s.split(',').map((x) => x.split('=')).map(([k, v]) => [k, Number(v)]));
const src = parse(process.argv[1]), dst = parse(process.argv[2]);
const diff = Object.keys({ ...src, ...dst }).filter((k) => src[k] !== dst[k]).map((k) => ({ table: k, source: src[k], restored: dst[k] }));
const out = { file: process.argv[3], sizeKb: Math.round(Number(process.argv[4]) / 1024), backupMs: +process.argv[5], createDbMs: +process.argv[6], restoreMs: +process.argv[7],
  appStartMs: +process.argv[8], appStarted: process.argv[9] === '1', pages: process.argv[10].trim(), tables: Object.keys(src).length,
  rows: Object.values(src).reduce((a, b) => a + b, 0), tablesThatDiffer: diff, ibansDecrypt: process.argv[11], invariants: process.argv[12],
  totalMs: +process.argv[5] + +process.argv[6] + +process.argv[7] + +process.argv[8] };
console.log(JSON.stringify(out, null, 1));
require('fs').writeFileSync('$OUT/backup-drill.json', JSON.stringify(out, null, 1));
" "$SRC_COUNTS" "$DST_COUNTS" "$FILE" "$SIZE" $((T1-T0)) $((T2-T1)) $((T3-T2)) $((T5-T4)) "$UP" "$PAGES" "$DECRYPT" "$INV"
