#!/bin/zsh
# Copy the sync code into the function and deploy it to your Vercel account (production).
# Run once after cloud/setup.py, and again whenever pull.py, ledger.py or sync.py change
# (scripts/morning.sh does that for you).
set -e
HERE="${0:A:h}"
ROOT="${HERE:h}"
mkdir -p "$HERE/api/_lib"
cp "$ROOT/pull.py" "$ROOT/ledger.py" "$ROOT/sync.py" "$HERE/api/_lib/"
cd "$HERE"
vercel deploy --prod --yes
