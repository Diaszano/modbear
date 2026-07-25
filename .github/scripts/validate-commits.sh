#!/usr/bin/env bash
set -euo pipefail

from_sha="${1:-}"
to_sha="${2:-HEAD}"
zero_sha="0000000000000000000000000000000000000000"
legacy_sha="71b9576b9b0d50ffd04f10fb51bcb521b4b811bb"

if [[ -z "$from_sha" || "$from_sha" == "$zero_sha" ]]; then
  commit_range="$to_sha"
else
  commit_range="$from_sha..$to_sha"
fi

commit_shas="$(git rev-list --reverse "$commit_range")"
if [[ -z "$commit_shas" ]]; then
  exit 0
fi

while IFS= read -r commit_sha; do
  if [[ "$commit_sha" == "$legacy_sha" ]]; then
    echo "Skipping conventional commit validation for legacy commit $commit_sha"
    continue
  fi

  git show --quiet --format=%B "$commit_sha" | npx --no -- commitlint --verbose
done <<< "$commit_shas"
