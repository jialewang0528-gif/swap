"""One-time setup for the private cloud link (optional, see README "Auto-update").

Reads your Plaid keys from .env and your saved link from data/tokens.json, puts them in your own
Vercel project's environment variables (never in code, never printed), makes a random app key,
and writes app/private/cloud-config.js so your phone build knows where to ask.

  vercel login                      # once
  python3 cloud/setup.py            # optional: --project my-swap-sync --person p00
  zsh cloud/deploy.sh
"""

import argparse
import json
import os
import secrets
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read_env():
    env = {}
    with open(os.path.join(ROOT, ".env")) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def vercel(*args, value=None):
    return subprocess.run(["vercel", *args], cwd=HERE, input=value, text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default="swap-private-sync")
    parser.add_argument("--person", default="p00")
    args = parser.parse_args()

    env = read_env()
    tokens = json.load(open(os.path.join(ROOT, "data", "tokens.json")))
    if args.person not in tokens:
        sys.exit(f"No saved link for {args.person}. Run `python3 pull.py link --person {args.person}` first.")
    if tokens[args.person]["env"] != env.get("PLAID_ENV"):
        sys.exit("Your saved link and PLAID_ENV in .env don't match.")

    if not os.path.isdir(os.path.join(HERE, ".vercel")):
        vercel("project", "add", args.project)
        r = vercel("link", "--yes", "--project", args.project)
        if r.returncode:
            sys.exit("vercel link failed. Run `vercel login` first.\n" + r.stderr[-300:])
        for f in (".env.local",):
            p = os.path.join(HERE, f)
            if os.path.exists(p):
                os.remove(p)

    app_key = secrets.token_urlsafe(32)
    values = {
        "PLAID_CLIENT_ID": env.get("PLAID_CLIENT_ID", ""), "PLAID_SECRET": env.get("PLAID_SECRET", ""),
        "PLAID_ENV": env.get("PLAID_ENV", ""), "PLAID_ACCESS_TOKEN": tokens[args.person]["access_token"],
        "SWAP_APP_TOKEN": app_key, "HIDE_MERCHANTS": env.get("HIDE_MERCHANTS", ""),
        "SUPPORT_SENDERS": env.get("SUPPORT_SENDERS", ""),
        "RIDE_APP_NAME": env.get("RIDE_APP_NAME", ""), "RECOMMEND_RIDE_APP": env.get("RECOMMEND_RIDE_APP", ""),
    }
    for name, value in values.items():
        if not value:
            continue
        vercel("env", "rm", name, "production", "--yes")
        r = vercel("env", "add", name, "production", "--sensitive", value=value)
        if r.returncode:
            r = vercel("env", "add", name, "production", value=value)
        print(f"{name}: {'set' if r.returncode == 0 else 'FAILED'}")

    project = json.load(open(os.path.join(HERE, ".vercel", "project.json")))
    url = f"https://{project.get('projectName') or args.project}.vercel.app"
    os.makedirs(os.path.join(ROOT, "app", "private"), exist_ok=True)
    out = os.path.join(ROOT, "app", "private", "cloud-config.js")
    with open(out, "w") as f:
        f.write("/* PRIVATE (gitignored): written by cloud/setup.py. */\n")
        f.write(f'window.SwapCloudConfig = {{ url: "{url}", token: "{app_key}" }};\n')
    os.chmod(out, 0o600)
    print(f"Wrote app/private/cloud-config.js for {url}. Now run: zsh cloud/deploy.sh")


if __name__ == "__main__":
    main()
