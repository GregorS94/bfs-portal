#!/usr/bin/env bash
#
# Rollt den Stand des Repositorys auf den Zielhost aus und baut die Container neu.
#
# Das Repository ist die Quelle der Wahrheit, nicht der Host. Wer direkt auf dem
# Host editiert, verliert die Änderung beim nächsten Ausrollen — dagegen hilft
# `check-drift.sh`, das vor dem Kopieren automatisch läuft.
#
#   scripts/deploy.sh              # ausrollen und neu bauen
#   DEPLOY_HOST=user@host scripts/deploy.sh
#
set -euo pipefail

HOST="${DEPLOY_HOST:-steppat@pihole}"
REMOTE_DIR="${DEPLOY_DIR:-~/bfs-portal}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_ROOT"

# Was auf dem Host nichts zu suchen hat. Die .env bleibt bewusst dort liegen:
# sie enthält die Zugangsdaten und gehört nicht ins Repository.
EXCLUDES=(
  --exclude '.git' --exclude 'node_modules' --exclude '.env'
  --exclude 'docs' --exclude 'scripts' --exclude 'README.md'
  --exclude 'AGENTS.md' --exclude '.gitignore' --exclude '.env.example'
  --exclude '*.bak' --exclude '._*'
)

echo "==> Abgleich mit $HOST:$REMOTE_DIR"
"$REPO_ROOT/scripts/check-drift.sh" || {
  echo
  echo "Auf dem Host stehen Änderungen, die das Repository nicht kennt."
  echo "Erst übernehmen oder verwerfen, sonst gehen sie verloren."
  exit 1
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Hinweis: nicht eingecheckte Änderungen im Arbeitsverzeichnis."
fi

echo "==> Kopieren"
rsync -a --delete "${EXCLUDES[@]}" ./ "$HOST:$REMOTE_DIR/"

echo "==> Container neu bauen"
ssh "$HOST" "cd $REMOTE_DIR && docker compose up -d --build"

echo "==> Status"
ssh "$HOST" "cd $REMOTE_DIR && docker compose ps"

if [[ -n "$(git log --branches --not --remotes --oneline 2>/dev/null)" ]]; then
  echo
  echo "Noch nicht gepusht:"
  git log --branches --not --remotes --oneline
  echo "  git push"
fi
