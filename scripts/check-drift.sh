#!/usr/bin/env bash
#
# Meldet Dateien, die auf dem Zielhost von dem Stand abweichen, der dort zuletzt
# ausgerollt wurde.
#
# Der Vergleich läuft bewusst nicht gegen das Arbeitsverzeichnis: dann sähe jede
# neue, noch nicht ausgerollte Änderung wie eine Manipulation auf dem Host aus,
# und der Check würde jedes normale Ausrollen blockieren. Verglichen wird gegen
# den Commit, den `deploy.sh` beim letzten Mal auf dem Host hinterlegt hat.
#
# Exit 0: der Host entspricht dem zuletzt ausgerollten Stand.
# Exit 1: auf dem Host wurde direkt gearbeitet.
#
set -euo pipefail

HOST="${DEPLOY_HOST:-steppat@pihole}"
REMOTE_DIR="${DEPLOY_DIR:-~/bfs-portal}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP=".deployed-commit"

EXCLUDES=(
  --exclude '.git' --exclude 'node_modules' --exclude '.env'
  --exclude 'docs' --exclude 'scripts' --exclude 'README.md'
  --exclude 'AGENTS.md' --exclude '.gitignore' --exclude '.env.example'
  --exclude '*.bak' --exclude '._*' --exclude "$STAMP"
)

deployed=$(ssh "$HOST" "cat $REMOTE_DIR/$STAMP 2>/dev/null" || true)

if [[ -z "$deployed" ]]; then
  echo "Auf dem Host ist kein ausgerollter Stand vermerkt ($STAMP fehlt)."
  echo "Erster Lauf nach der Umstellung — der Vergleich wird übersprungen."
  exit 0
fi

if ! git -C "$REPO_ROOT" cat-file -e "${deployed}^{commit}" 2>/dev/null; then
  echo "Der auf dem Host vermerkte Commit $deployed ist hier unbekannt."
  echo "Wurde von einem anderen Rechner ausgerollt? Erst klären."
  exit 1
fi

# Den ausgerollten Stand auspacken und den Host damit vergleichen.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$REPO_ROOT" archive "$deployed" | tar -x -C "$tmp"

changed=$(rsync -rcn --itemize-changes "${EXCLUDES[@]}" \
  "$HOST:$REMOTE_DIR/" "$tmp/" 2>/dev/null \
  | grep -E '^[<>ch]' | grep -v '^\.d' || true)

if [[ -z "$changed" ]]; then
  echo "Host entspricht dem ausgerollten Stand (${deployed:0:7})."
  exit 0
fi

echo "Auf $HOST wurde direkt gearbeitet — Abweichung vom ausgerollten Stand (${deployed:0:7}):"
echo "$changed"
exit 1
