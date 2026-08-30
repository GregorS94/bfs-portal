#!/usr/bin/env bash
#
# Meldet Dateien, die auf dem Zielhost anders sind als im Repository.
#
# Exit 0: identisch. Exit 1: der Host hat Stände, die das Repository nicht kennt.
# Läuft automatisch vor jedem `deploy.sh`.
#
set -euo pipefail

HOST="${DEPLOY_HOST:-steppat@pihole}"
REMOTE_DIR="${DEPLOY_DIR:-~/bfs-portal}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Nur Dateien vergleichen, die es auf beiden Seiten geben soll. Die Dokumentation
# und die Skripte liegen bewusst nur im Repository.
EXCLUDES=(
  --exclude '.git' --exclude 'node_modules' --exclude '.env'
  --exclude 'docs' --exclude 'scripts' --exclude 'README.md'
  --exclude 'AGENTS.md' --exclude '.gitignore' --exclude '.env.example'
  --exclude '*.bak' --exclude '._*'
)

# Richtung Host -> Repository: was hier ankäme, ist auf dem Host neuer oder anders.
# -c vergleicht Prüfsummen statt Zeitstempel; nach einem rsync sind die Zeiten
# ohnehin identisch, die Inhalte sind die Frage.
changed=$(rsync -rcn --itemize-changes "${EXCLUDES[@]}" \
  "$HOST:$REMOTE_DIR/" "$REPO_ROOT/" 2>/dev/null \
  | grep -E '^[<>ch]' | grep -v '^\.d' || true)

if [[ -z "$changed" ]]; then
  echo "Host und Repository sind identisch."
  exit 0
fi

echo "Abweichungen auf $HOST:"
echo "$changed"
exit 1
