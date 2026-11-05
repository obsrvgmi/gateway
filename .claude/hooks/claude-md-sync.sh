#!/usr/bin/env bash
# Stop hook: asks the agent to refresh CLAUDE.md when uncommitted code is newer than it.
input=$(cat)
# Claude Code sets this when it is already continuing from this hook; never block twice.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
stale=0
while IFS= read -r file; do
  [ -f "$file" ] && [ "$file" -nt CLAUDE.md ] && { stale=1; break; }
done < <(git status --porcelain --untracked-files=all -- app lib components/dashboard components/checkout components/marketing components/brand styles | sed -E 's/^.{3}//; s/^"//; s/"$//')

if [ "$stale" = 1 ]; then
  printf '%s\n' '{"decision":"block","reason":"Code changed after CLAUDE.md was last updated. If routes, the data model, lib/, shared components, conventions, or the mock-vs-real table changed, update CLAUDE.md now. If not, say so and stop."}'
fi
