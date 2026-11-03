#!/bin/zsh
# Morning refresh for the founder's phone: pull fresh Plaid data, rebuild the iOS app with it,
# and reinstall on his iPhone (USB or same Wi-Fi). Reinstalling also renews the free 7-day signing.
# Run by launchd (scripts/lol.michaelwang.swap.morning.plist) or by hand: zsh scripts/morning.sh
set -u
ROOT="${0:A:h:h}"
LOG="$ROOT/data/morning.log"
# iPhone UDID and Apple team come from .env (SWAP_DEVICE, SWAP_TEAM), kept out of git.
DEVICE="$(grep -m1 '^SWAP_DEVICE=' "$ROOT/.env" | cut -d= -f2-)"
TEAM="$(grep -m1 '^SWAP_TEAM=' "$ROOT/.env" | cut -d= -f2-)"
BUNDLE="$(grep -m1 '^SWAP_BUNDLE_ID=' "$ROOT/.env" | cut -d= -f2-)"   # optional: your own app id
mkdir -p "$ROOT/data"
exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M') ==="

cd "$ROOT" || exit 1
/usr/bin/python3 sync.py || { echo "sync failed"; exit 1; }

# If you set up the cloud link (cloud/.vercel exists), keep it on the same sync code and the same
# .env options as this Mac. A deploy only counts once it succeeds (data/cloud-deployed.sha), so a
# failed one is tried again next morning. Details go to data/cloud-deploy.log.
if [ -d "$ROOT/cloud/.vercel" ]; then
  export PATH="$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  CLOG="$ROOT/data/cloud-deploy.log"
  /usr/bin/python3 "$ROOT/cloud/sync_env.py" --if-changed >>"$CLOG" 2>&1
  case $? in
    0) ;;
    3) echo "cloud options updated" ;;
    *) echo "cloud options sync failed (see data/cloud-deploy.log)" ;;
  esac
  STAMP="$(cat "$ROOT/pull.py" "$ROOT/ledger.py" "$ROOT/sync.py" "$ROOT/data/cloud-options.sha" 2>/dev/null | shasum | cut -d' ' -f1)"
  if [ "$STAMP" != "$(cat "$ROOT/data/cloud-deployed.sha" 2>/dev/null)" ]; then
    zsh "$ROOT/cloud/deploy.sh" >>"$CLOG" 2>&1 && echo "cloud redeployed" || echo "cloud deploy failed (see data/cloud-deploy.log)"
  fi
fi

xcodebuild -project ios/Swap.xcodeproj -scheme Swap -configuration Debug \
  -destination "id=$DEVICE" -derivedDataPath ios/build -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" ${BUNDLE:+PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE"} build -quiet || { echo "build failed"; exit 1; }

if xcrun devicectl list devices 2>/dev/null | grep -q "$DEVICE.*connected"; then
  xcrun devicectl device install app --device "$DEVICE" ios/build/Build/Products/Debug-iphoneos/Swap.app \
    && echo "installed" || echo "install failed"
else
  echo "phone not reachable (not on the same Wi-Fi or USB); data synced, install skipped"
fi
