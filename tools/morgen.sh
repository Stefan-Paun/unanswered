#!/bin/zsh
# Morgen-Scan für launchd: Liste als HTML + Markdown nach data/, Hinweis per terminal-notifier (falls installiert).
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node bin/ungeloest.mjs scan --html data/morgen.html --md data/morgen.md >> data/morgen.log 2>&1
code=$?
if command -v terminal-notifier >/dev/null; then
  terminal-notifier -title "Ungelöst" -message "Morgen-Liste ist da (Exit $code)" -open "file://$PWD/data/morgen.html"
fi
exit $code
