#!/usr/bin/env bash
# The 30-minute soak: steady browsing (60 visitors, think 1–3 s) plus two buyers asking and paying every 10 s, with the monitor sampling
# CPU, memory and database connections every second. A leak shows as memory that keeps climbing after the first minutes.
#   DATABASE_URL=... scripts/rehearsal/soak.sh [minutes] [visitors]
set -uo pipefail
cd "$(dirname "$0")/../.."
MIN="${1:-30}"; V="${2:-60}"
END=$(( $(date +%s) + MIN * 60 ))
( while [ "$(date +%s)" -lt "$END" ]; do node tests/load/pay.js --buyers 2 --offset $(( RANDOM % 490 )) > /dev/null 2>&1; sleep 10; done ) &
PAYER=$!
scripts/rehearsal/run.sh "soak-${MIN}min" node tests/load/browse.js --vus "$V" --duration $(( MIN * 60 )) --ramp 30
kill $PAYER 2>/dev/null
node -e "
const m = require('./tests/load/results/soak-${MIN}min.monitor.json').samples.filter((s) => !s.error);
const per5 = []; for (let i = 0; i < m.length; i += 300) { const w = m.slice(i, i + 300); per5.push({ minute: Math.round(i / 60), rssAvg: Math.round(w.reduce((a, s) => a + s.rss, 0) / w.length), rssMax: Math.max(...w.map((s) => s.rss)), cpuAvg: Math.round(w.reduce((a, s) => a + s.cpu, 0) / w.length) }); }
console.log('memory per 5 minutes:', JSON.stringify(per5));"
