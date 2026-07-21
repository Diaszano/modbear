#!/usr/bin/env bash
set -euo pipefail

from_sha="${1:-}"
to_sha="${2:-HEAD}"
zero_sha="0000000000000000000000000000000000000000"

if [[ -z "$from_sha" || "$from_sha" == "$zero_sha" ]]; then
  root_sha="$(git rev-list --max-parents=0 "$to_sha" | tail -n 1)"
  git show --quiet --format=%B "$root_sha" | npx --no -- commitlint

  if [[ "$root_sha" != "$to_sha" ]]; then
    npx --no -- commitlint --from "$root_sha" --to "$to_sha" --verbose
  fi
else
  npx --no -- commitlint --from "$from_sha" --to "$to_sha" --verbose
fi
