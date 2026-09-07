#!/bin/zsh
# Double-click on macOS, or run ./start-local.command from a terminal.
set -e
cd "${0:A:h}"
BUNDLE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if ! command -v node >/dev/null 2>&1 && [[ -x "$BUNDLE/node/bin/node" ]]; then
  export PATH="$BUNDLE/node/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  print 'Install Node.js 22.13 or newer, then run this launcher again.'
  read '?Press Return to close.'
  exit 1
fi
if command -v pnpm >/dev/null 2>&1; then
  RUNNER=(pnpm)
elif [[ -f "$BUNDLE/node/node_modules/pnpm/bin/pnpm.cjs" ]]; then
  RUNNER=(node "$BUNDLE/node/node_modules/pnpm/bin/pnpm.cjs")
elif command -v corepack >/dev/null 2>&1; then
  RUNNER=(corepack pnpm)
else
  print 'Install pnpm, then run this launcher again.'
  read '?Press Return to close.'
  exit 1
fi
[[ -d node_modules ]] || "${RUNNER[@]}" install --frozen-lockfile
print '\nHoneycomb Workshop — open the Local URL shown below. Press Control-C to stop.\n'
exec "${RUNNER[@]}" dev
