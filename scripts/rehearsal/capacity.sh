#!/usr/bin/env bash
# The breaking point: browses at rising numbers of visitors (think time 1–3 s, like people) and prints p50/p95/p99, errors and CPU for
# each step. The server must already run (scripts/rehearsal/start-server.sh <plan>).
#   DATABASE_URL=... scripts/rehearsal/capacity.sh <label> [seconds per step] [visitor counts...]
#   e.g. scripts/rehearsal/capacity.sh starter 60 25 50 75 100 150 200
# Writes tests/load/results/capacity-<label>.json
set -uo pipefail
cd "$(dirname "$0")/../.."
LABEL="$1"; SECS="${2:-60}"; shift 2 || true
LEVELS=("${@:-25 50 100 150 200}")
[ $# -eq 0 ] && LEVELS=(25 50 100 150 200)
OUT=tests/load/results; mkdir -p "$OUT"
PID=$(cat /tmp/wisecall-rehearsal.pid)
echo "[" > "$OUT/capacity-$LABEL.json"; FIRST=1
for V in "${LEVELS[@]}"; do
  node scripts/rehearsal/monitor.js "$PID" "/tmp/cap-$LABEL-$V.monitor.json" > "/tmp/cap-$LABEL-$V.monitor.txt" &
  MON=$!
  node tests/load/browse.js --vus "$V" --duration "$SECS" --ramp 10 --out "/tmp/cap-$LABEL-$V.json" > /dev/null 2>&1
  kill -INT $MON; wait $MON 2>/dev/null
  LINE=$(node -e "
    const r = require('/tmp/cap-$LABEL-$V.json'); const m = require('/tmp/cap-$LABEL-$V.monitor.json').summary;
    const errs = r.overall.errors5xx + r.overall.failed;
    console.log(JSON.stringify({ visitors: $V, rps: r.rps, p50: r.overall.p50, p95: r.overall.p95, p99: r.overall.p99, htmlP95: r.html.p95, errors: errs,
      errorRate: +(errs / Math.max(1, r.overall.n) * 100).toFixed(2), cpuAvg: m.cpuAvg, rssMax: m.rssMax, dbMax: m.dbTotalMax }));")
  echo "  $LINE"
  [ $FIRST -eq 1 ] && FIRST=0 || echo "," >> "$OUT/capacity-$LABEL.json"
  echo "$LINE" >> "$OUT/capacity-$LABEL.json"
  sleep 5
done
echo "]" >> "$OUT/capacity-$LABEL.json"
