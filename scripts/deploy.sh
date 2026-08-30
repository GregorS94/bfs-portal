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
#   DEPLOY_ACCEPT_HOST=1 scripts/deploy.sh   # gemeldete Abweichung ueberschreiben
#
# Ausgerollt wird der eingecheckte Stand. Ein schmutziges Arbeitsverzeichnis
# bricht ab: die Marke .deployed-commit nennt sonst einen Commit, der nicht dem
# entspricht, was tatsaechlich auf dem Host liegt — und der naechste Drift-Check
# haelt die eigene Aenderung fuer eine Manipulation am Host. Genau das ist am
# 30.08.2026 passiert.
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
  --exclude '*.bak' --exclude '._*' --exclude '.deployed-commit'
)

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Nicht eingecheckte Änderungen im Arbeitsverzeichnis."
  echo "Erst committen — sonst liegt auf dem Host ein Stand, den kein Commit beschreibt."
  git status --short
  exit 1
fi

echo "==> Abgleich mit $HOST:$REMOTE_DIR"
if [[ "${DEPLOY_ACCEPT_HOST:-0}" == "1" ]]; then
  echo "DEPLOY_ACCEPT_HOST=1 — Abweichung auf dem Host wird überschrieben."
else
  "$REPO_ROOT/scripts/check-drift.sh" || {
    echo
    echo "Auf dem Host stehen Änderungen, die das Repository nicht kennt."
    echo "Erst ansehen und übernehmen oder verwerfen, sonst gehen sie verloren."
    echo "Wenn sie nachweislich egal sind: DEPLOY_ACCEPT_HOST=1 scripts/deploy.sh"
    exit 1
  }
fi

echo "==> Kopieren"
rsync -a --delete "${EXCLUDES[@]}" ./ "$HOST:$REMOTE_DIR/"

# Merken, welcher Stand jetzt dort liegt. Ohne diese Marke koennte der
# Drift-Check beim naechsten Mal nicht unterscheiden, ob eine Abweichung vom
# Host stammt oder einfach eine noch nicht ausgerollte Aenderung ist.
ssh "$HOST" "printf '%s' '$(git rev-parse HEAD)' > $REMOTE_DIR/.deployed-commit"

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
