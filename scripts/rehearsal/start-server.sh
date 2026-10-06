#!/usr/bin/env bash
# Starts Wisecall for the rehearsal (scripts/rehearsal/server-prodlike.js: production caching, the fake bank and ID check, fake email
# and Daily APIs), against the rehearsal database, inside a cgroup
# that imitates a Render plan's CPU and memory (Linux cgroup v1; needs root, as in the cloud container).
#
#   DATABASE_URL=postgresql://.../wisecall_rehearsal scripts/rehearsal/start-server.sh [plan] [port]
#     plan: starter (0.5 CPU, 512 MB) | standard (1 CPU, 2 GB) | pro (2 CPU, 4 GB) | free (0.1 CPU, 512 MB) | none
#   Writes the server's pid to /tmp/wisecall-rehearsal.pid and its log to /tmp/wisecall-rehearsal.log.
# Plan sizes are Render's published ones at the time of writing [VERIFY on render.com/pricing].
set -euo pipefail
PLAN="${1:-starter}"; PORT="${2:-4300}"
cd "$(dirname "$0")/../.."
case "$PLAN" in
  free)     QUOTA=10000;  MEM=512 ;;
  starter)  QUOTA=50000;  MEM=512 ;;
  standard) QUOTA=100000; MEM=2048 ;;
  pro)      QUOTA=200000; MEM=4096 ;;
  none)     QUOTA=-1;     MEM=0 ;;
  *) echo "unknown plan $PLAN"; exit 1 ;;
esac
[[ "${DATABASE_URL:-}" == *rehearsal* || "${DATABASE_URL:-}" == *test* ]] || { echo "DATABASE_URL must be a rehearsal/test database"; exit 1; }

CG=wc_rehearsal
# the fake email and video APIs (scripts/rehearsal/fake-upstreams.js)
UPSTREAM="${UPSTREAM:-4399}"
if ! curl -fs "http://localhost:$UPSTREAM/__stats" >/dev/null 2>&1; then
  nohup node scripts/rehearsal/fake-upstreams.js "$UPSTREAM" > /tmp/wisecall-upstreams.log 2>&1 &
  sleep 0.5
fi
if [ "$PLAN" != none ]; then
  mkdir -p /sys/fs/cgroup/cpu/$CG /sys/fs/cgroup/memory/$CG
  echo 100000 > /sys/fs/cgroup/cpu/$CG/cpu.cfs_period_us
  echo "$QUOTA" > /sys/fs/cgroup/cpu/$CG/cpu.cfs_quota_us
  echo $((MEM * 1024 * 1024)) > /sys/fs/cgroup/memory/$CG/memory.limit_in_bytes
fi

# Node keeps its heap below the plan's memory (Render does not do this for you: see docs/TODO-REHEARSAL.md).
HEAP=$(( MEM > 0 ? MEM * 3 / 4 : 2048 ))
(
  if [ "$PLAN" != none ]; then echo $BASHPID > /sys/fs/cgroup/cpu/$CG/tasks; echo $BASHPID > /sys/fs/cgroup/memory/$CG/tasks; fi
  exec env NODE_ENV=development PORT="$PORT" PUBLIC_URL="http://localhost:$PORT" LAUNCH_MODE=live \
    PAYMENT_PROVIDER=mock KYC_PROVIDER=mock ADMIN_2FA=off ADMIN_EMAILS=rehearsal.admin@example.test \
    EMAIL_PROVIDER=resend RESEND_API_KEY=rehearsal-fake-key RESEND_API_URL="http://localhost:$UPSTREAM/emails" \
    LIVE_PROVIDER="${LIVE_PROVIDER:-daily}" DAILY_API_KEY=rehearsal-fake-key DAILY_API_URL="http://localhost:$UPSTREAM/v1" \
    RATE_LIMIT_MULTIPLIER="${RATE_LIMIT_MULTIPLIER:-1000}" SWEEP_INTERVAL_SECONDS="${SWEEP_INTERVAL_SECONDS:-60}" \
    node --max-old-space-size="$HEAP" ${EXTRA_NODE_FLAGS:-} "${ENTRY:-scripts/rehearsal/server-prodlike.js}"
) > /tmp/wisecall-rehearsal.log 2>&1 &
echo $! > /tmp/wisecall-rehearsal.pid
for i in $(seq 1 60); do
  if curl -fs "http://localhost:$PORT/healthz" >/dev/null 2>&1; then echo "Wisecall up on :$PORT (plan $PLAN, pid $(cat /tmp/wisecall-rehearsal.pid))"; exit 0; fi
  sleep 0.5
done
echo "server did not start"; tail -20 /tmp/wisecall-rehearsal.log; exit 1
