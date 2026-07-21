#!/usr/bin/env bash
set -euo pipefail

stable_semver_tags() {
  git tag --list | LC_ALL=C awk '/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/'
}

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 snapshot <snapshot-file> | resolve <snapshot-file> <github-output>" >&2
  exit 2
fi

mode="$1"
snapshot_file="$2"

case "$mode" in
  snapshot)
    if [[ $# -ne 2 ]]; then
      echo "Usage: $0 snapshot <snapshot-file>" >&2
      exit 2
    fi

    stable_semver_tags | LC_ALL=C sort -u > "$snapshot_file"
    ;;
  resolve)
    if [[ $# -ne 3 ]]; then
      echo "Usage: $0 resolve <snapshot-file> <github-output>" >&2
      exit 2
    fi
    if [[ ! -f "$snapshot_file" ]]; then
      echo "Release tag snapshot not found: $snapshot_file" >&2
      exit 1
    fi

    github_output="$3"
    current_tags="$(mktemp)"
    trap 'rm -f "$current_tags"' EXIT
    stable_semver_tags | LC_ALL=C sort -u > "$current_tags"
    new_tags_output="$(comm -13 "$snapshot_file" "$current_tags")"
    new_tags=()
    if [[ -n "$new_tags_output" ]]; then
      mapfile -t new_tags <<< "$new_tags_output"
    fi

    case "${#new_tags[@]}" in
      0)
        echo "published=false" >> "$github_output"
        ;;
      1)
        echo "published=true" >> "$github_output"
        echo "version=${new_tags[0]#v}" >> "$github_output"
        ;;
      *)
        echo "Multiple new stable release tags detected: ${new_tags[*]}" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    exit 2
    ;;
esac
