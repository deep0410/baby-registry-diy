#!/usr/bin/env bash
#
# Creates a GitHub repo and pushes this project to it, using the GitHub CLI.
#
# Prerequisites:
#   - GitHub CLI installed:  https://cli.github.com
#   - Signed in:             gh auth login
#
# Usage:
#   ./scripts/publish.sh [repo-name]      # default repo name: baby-registry-diy
#
set -euo pipefail

REPO="${1:-baby-registry-diy}"
VISIBILITY="${VISIBILITY:-public}"   # set VISIBILITY=private for a private repo

command -v git >/dev/null 2>&1 || { echo "❌ git not found."; exit 1; }
command -v gh  >/dev/null 2>&1 || { echo "❌ GitHub CLI not found. Install: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "❌ Not signed in. Run: gh auth login"; exit 1; }

# Clear stale git locks (some synced/mounted filesystems leave these behind)
rm -f .git/index.lock .git/HEAD.lock .git/objects/*/tmp_obj_* 2>/dev/null || true

# Safety: never publish a real .env.local
if git check-ignore -q .env.local 2>/dev/null; then :; else
  echo "⚠️  .env.local is not gitignored — aborting to avoid leaking secrets."; exit 1
fi

if [ ! -d .git ]; then
  echo "🟡 Initializing git repo..."
  git init -q
  git branch -M main
fi

git add -A
git commit -qm "Initial commit: baby registry" 2>/dev/null || echo "ℹ️  Nothing new to commit."

echo "🟡 Creating GitHub repo '$REPO' ($VISIBILITY) and pushing..."
gh repo create "$REPO" --"$VISIBILITY" --source=. --remote=origin --push

URL="$(gh repo view "$REPO" --json url -q .url)"
echo "✅ Pushed to $URL"
echo
echo "Next — deploy to Vercel:"
echo "  1) Go to https://vercel.com/new and import $REPO"
echo "  2) Add the environment variables from your .env.local"
echo "  3) Deploy. (Or run 'vercel' / 'vercel --prod' if you have the Vercel CLI.)"
