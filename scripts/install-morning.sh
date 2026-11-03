#!/bin/zsh
# Install the 7:30am job: sync your bank, rebuild the app, reinstall it on your phone if reachable.
# Safe to run again (it replaces the old job).
set -e
ROOT="${0:A:h:h}"
LABEL="swap.morning"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data"
sed -e "s#__ROOT__#$ROOT#g" -e "s#<string>lol.michaelwang.swap.morning</string>#<string>$LABEL</string>#" "$ROOT/scripts/swap.morning.plist" > "$DEST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "Installed. Runs daily at 7:30am. Log: data/morning.log"
