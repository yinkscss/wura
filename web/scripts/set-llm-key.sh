#!/usr/bin/env bash
# Saves your model API key into web/.env.local (git-ignored) without showing it.
# Usage, from the web folder: bash scripts/set-llm-key.sh
set -euo pipefail
cd "$(dirname "$0")/.."
touch .env.local
chmod 600 .env.local

read -r -s -p "Paste your API key, then press Enter (input is hidden): " key
echo
if [ -z "$key" ]; then echo "No key entered. Nothing changed."; exit 1; fi

# Drop any old LLM_API_KEY line, then append the new one.
grep -v '^LLM_API_KEY=' .env.local > .env.local.tmp || true
mv .env.local.tmp .env.local
chmod 600 .env.local
printf 'LLM_API_KEY=%s\n' "$key" >> .env.local
unset key
echo "Saved LLM_API_KEY to web/.env.local."
