# Shared bootstrap selection; no system Node is needed.
select_runtime() {
  for prefix in app rollback; do
    found=$(for dir in "$ROOT"/"$prefix"-*; do
      version=${dir##*/}; version=${version#"$prefix"-}
      printf '%s\n' "$version" | grep -Eq '^[0-9]+(\.[0-9]+)+$' || continue
      [ -f "$dir/.complete" ] && [ -f "$dir/kimi-desktop" ] && [ -x "$dir/kimi-desktop" ] && [ -f "$dir/resources/app.asar" ] && [ -s "$dir/resources/app.asar" ] && printf '%s\n' "$dir"
    done | sort -V | tail -1)
    if [ -n "$found" ]; then printf '%s\n' "$found"; return; fi
  done
  return 1
}
