#!/bin/zsh
# Copy the sync code into the function and deploy it to your Vercel account (production).
# Run once after cloud/setup.py, and again whenever pull.py, ledger.py or sync.py change
# (scripts/morning.sh does that for you). Tries 3 times with a growing wait; exits non-zero if
# every try fails. Only a successful deploy writes data/cloud-deployed.sha, so a failed one is
# tried again on the next morning run.
set -u
HERE="${0:A:h}"
ROOT="${HERE:h}"
mkdir -p "$HERE/api/_lib" "$ROOT/data"
cp "$ROOT/pull.py" "$ROOT/ledger.py" "$ROOT/sync.py" "$HERE/api/_lib/" || { echo "deploy: copy failed"; exit 1; }
cd "$HERE" || exit 1
for wait in 10 30 0; do
  if vercel deploy --prod --yes; then
    # Same stamp as scripts/morning.sh: the sync code plus the options last pushed by sync_env.py.
    cat "$ROOT/pull.py" "$ROOT/ledger.py" "$ROOT/sync.py" "$ROOT/data/cloud-options.sha" 2>/dev/null | shasum | cut -d' ' -f1 > "$ROOT/data/cloud-deployed.sha"
    echo "$(date '+%Y-%m-%d %H:%M') deploy: ok"
    exit 0
  fi
  [ "$wait" = 0 ] && break
  echo "$(date '+%Y-%m-%d %H:%M') deploy: failed, trying again in ${wait}s"
  sleep "$wait"
done
echo "$(date '+%Y-%m-%d %H:%M') deploy: FAILED after 3 tries"
exit 1
