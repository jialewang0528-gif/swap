"""Keep the cloud function's non-secret options in step with .env.

The options are HIDE_MERCHANTS, CLUB_MERCHANTS, RIDE_APP_NAME, RECOMMEND_RIDE_APP, SUPPORT_SENDERS and
CATEGORY_OVERRIDES. Each one is removed from the Vercel project and added again with the .env value, so
clearing a value in .env clears it in the cloud too. It never touches SWAP_APP_TOKEN or the Plaid keys,
and never prints a value. A hash of the values is kept in data/cloud-options.sha to tell when they change.

  python3 cloud/sync_env.py               # push now
  python3 cloud/sync_env.py --if-changed  # push only if .env changed since the last push (scripts/morning.sh)

Exit codes: 0 = nothing to do, 3 = pushed (Vercel applies env changes on the next deploy, so deploy
after this), 1 = a push failed (the hash is not saved, so the next run tries again).
"""

import argparse
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from setup import ROOT, read_env, vercel  # noqa: E402

OPTIONS = ["HIDE_MERCHANTS", "CLUB_MERCHANTS", "RIDE_APP_NAME", "RECOMMEND_RIDE_APP", "SUPPORT_SENDERS", "CATEGORY_OVERRIDES"]
HASH_FILE = os.path.join(ROOT, "data", "cloud-options.sha")


def options_hash(env):
    return hashlib.sha256("".join(f"{k}={env.get(k, '')}\n" for k in OPTIONS).encode()).hexdigest()


def push(env):
    """Set every option in Vercel production from env. Returns True when all of them worked."""
    ok = True
    for name in OPTIONS:
        value = env.get(name, "")
        vercel("env", "rm", name, "production", "--yes")          # fine if it wasn't there
        if not value:
            print(f"{name}: cleared")
            continue
        r = vercel("env", "add", name, "production", "--sensitive", value=value)
        if r.returncode:
            r = vercel("env", "add", name, "production", value=value)
        print(f"{name}: {'set' if r.returncode == 0 else 'FAILED'}")
        ok = ok and r.returncode == 0
    if ok:
        os.makedirs(os.path.dirname(HASH_FILE), exist_ok=True)
        with open(HASH_FILE, "w") as f:
            f.write(options_hash(env) + "\n")
    return ok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--if-changed", action="store_true")
    args = parser.parse_args()
    if not os.path.isdir(os.path.join(HERE, ".vercel")):
        sys.exit("No cloud link here yet. Run cloud/setup.py first.")
    env = read_env()
    if args.if_changed and os.path.exists(HASH_FILE):
        with open(HASH_FILE) as f:
            if f.read().strip() == options_hash(env):
                return 0
    return 3 if push(env) else 1


if __name__ == "__main__":
    sys.exit(main())
