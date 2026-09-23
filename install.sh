#!/usr/bin/env bash
# Install zreview: the CLI on PATH, and the skill where Claude Code and omp load it.
#
#   curl -fsSL https://raw.githubusercontent.com/gzaripov/zreview/main/install.sh | bash
#   # or, from a checkout:
#   ./install.sh
#
# Idempotent. Re-run to update.
set -euo pipefail

REPO="https://github.com/gzaripov/zreview"
SRC="${ZREVIEW_SRC:-$HOME/code/zreview}"
CANON="$HOME/.agents/skills/zreview"          # one canonical copy of the skill
LINKS=("$HOME/.claude/skills/zreview")        # every place an agent looks for it

command -v bun >/dev/null || { echo "bun is required: https://bun.sh" >&2; exit 1; }
command -v gh  >/dev/null || echo "note: gh not found; zreview review will need --diff <file>" >&2

if [ -d "$SRC/.git" ]; then
  if git -C "$SRC" rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
    git -C "$SRC" pull --ff-only --quiet && echo "updated $SRC"
  else
    echo "using $SRC as is (no upstream to pull from)"
  fi
else
  git clone --quiet "$REPO" "$SRC" && echo "cloned $SRC"
fi

(cd "$SRC" && bun link >/dev/null 2>&1) && echo "linked: $(command -v zreview)"

mkdir -p "$(dirname "$CANON")"
ln -sfn "$SRC/skill" "$CANON" && echo "skill: $CANON -> $SRC/skill"
for link in "${LINKS[@]}"; do
  mkdir -p "$(dirname "$link")"
  ln -sfn "$CANON" "$link" && echo "skill: $link -> $CANON"
done

zreview --help | head -1
command -v zplan >/dev/null && echo "also linked: zplan (plan review)"
