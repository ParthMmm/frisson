#!/usr/bin/env bash
set -euo pipefail

# Install Bun (pinned toolchain for this repo) if it is not already available.
# Idempotent: skips the download when a bun binary already exists.
if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
	curl -fsSL https://bun.sh/install | bash
fi

export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

bun --version

# Install dependencies from the committed lockfile. `prepare` runs
# `svelte-kit sync`, generating the .svelte-kit types the app needs.
bun install --frozen-lockfile
