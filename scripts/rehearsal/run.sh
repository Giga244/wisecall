#!/usr/bin/env bash
# Runs one load test with the resource monitor around it and the invariants after it.
#   DATABASE_URL=... scripts/rehearsal/run.sh <name> <command...>
#   e.g. scripts/rehearsal/run.sh browse-200 node tests/load/browse.js --vus 200 --duration 300
# Results: tests/load/results/<name>.json (the test), <name>.monitor.json (CPU, memory, DB connections), <name>.invariants.json.
set -uo pipefail
cd "$(dirname "$0")/../.."
NAME="$1"; shift
OUTDIR=tests/load/results; mkdir -p "$OUTDIR"
PID=$(cat /tmp/wisecall-rehearsal.pid)
node scripts/rehearsal/monitor.js "$PID" "$OUTDIR/$NAME.monitor.json" > "$OUTDIR/$NAME.monitor.txt" &
MON=$!
"$@" --out "$OUTDIR/$NAME.json" 2>&1 | tee "$OUTDIR/$NAME.log"
kill -INT $MON; wait $MON 2>/dev/null
echo "resources: $(cat "$OUTDIR/$NAME.monitor.txt")"
node scripts/rehearsal/invariants.js --json > "$OUTDIR/$NAME.invariants.json"; RC=$?
node -e "const r=require('./$OUTDIR/$NAME.invariants.json'); console.log(r.violations.length ? '🔴 invariants violated: ' + r.violations.map(v => v.check + ' (' + v.count + ')').join('; ') : '✅ invariants hold (ledger diff ' + r.ledger.diff + ')')"
exit $RC
