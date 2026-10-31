#!/usr/bin/env bash
# Run on the box; references and the fixed review protocol stay outside Git.
# review-design.sh <review-dir> <out-base> <protocol-dir> [baseline-median.md]
set -euo pipefail
[[ $# -ge 3 && $# -le 4 ]] || {
  echo "Usage: $0 <review-dir> <out-base> <protocol-dir> [baseline-median.md]" >&2
  exit 2
}
review=$(cd "$1" && pwd)
out=$2
protocol=$(cd "$3" && pwd)
prompt="$protocol/REVIEW-PROMPT-orch.txt"
median="$protocol/tools/median.py"
[[ -f "$review/APPLE-SPEC.md" && -f "$prompt" && -f "$median" ]] || {
  echo 'Missing APPLE-SPEC.md or fixed review protocol' >&2
  exit 2
}
if [[ $# == 4 && ! -f "$4" ]]; then
  echo "Missing baseline: $4" >&2
  exit 2
fi
shopt -s nullglob
screens=("$review"/main-*.png "$review"/pages-*.png)
refs=("$review"/refs/*.png)
[[ ${#screens[@]} -gt 0 && ${#refs[@]} -gt 0 ]] || {
  echo 'Review requires live screens and reference PNGs' >&2
  exit 2
}
mkdir -p "$(dirname "$out")"
out="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
# Same prompt, image ordering and cold-run count as the external review3.sh.
# WWW-55 explicitly requests Sol medium rather than its Astra xhigh default.
inputs=("$0" "$prompt" "$median" "$review/APPLE-SPEC.md" "${screens[@]}" "${refs[@]}")
[[ $# == 4 ]] && inputs+=("$4")
shasum -a 256 "${inputs[@]}" > "$out-inputs.sha256"
images=$(printf '%s\n' "${screens[@]}" "${refs[@]}" | paste -sd, -)
pids=()
for run in 1 2 3; do
  codex exec -m gpt-6.1-sol -c model_reasoning_effort=medium \
    --skip-git-repo-check -s read-only -C "$review" \
    -o "$out-r$run.md" --image "$images" - < "$prompt" > "$out-r$run.log" 2>&1 &
  pids+=("$!")
done
status=0
for pid in "${pids[@]}"; do wait "$pid" || status=1; done
[[ "$status" == 0 ]] || exit "$status"
comparison=()
[[ $# == 4 ]] && comparison=(--base "$4")
python3 "$median" "$out"-r[123].md "${comparison[@]}" > "$out-median.md"
cat "$out-median.md"
