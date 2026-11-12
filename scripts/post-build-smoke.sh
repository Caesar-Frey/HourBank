#!/usr/bin/env zsh
# Post-build smoke test. Invoked by the PostToolUse Claude hook after Android builds.
# Outputs a [POST-BUILD] block to stderr — Claude reads it on the next turn and
# decides whether to run /qa based on the qa_recommendation field.

APP_ID="com.anonymous.hourbank"
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
PROJECT_ROOT="/Users/mag/Documents/HourBank/hourbank"

TS=$(date +%s)
SCREENSHOT="/tmp/hourbank-smoke-${TS}.png"
LOGCAT_FILE="/tmp/hourbank-logcat-${TS}.log"

# ── Guard: only run after Android builds ────────────────────────────────────
INPUT="${CLAUDE_TOOL_INPUT:-}"
if ! echo "$INPUT" | grep -qE "expo run:android|gradlew|npm run android|run:android"; then
  exit 0
fi

# ── Guard: need an online emulator ──────────────────────────────────────────
DEVICES=$("$ADB" devices 2>/dev/null | grep -v "List of" | grep -v "^$" | grep "emulator")
if [[ -z "$DEVICES" ]]; then
  exit 0
fi

# ── Launch app ───────────────────────────────────────────────────────────────
"$ADB" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 8

# ── Screenshot ───────────────────────────────────────────────────────────────
"$ADB" exec-out screencap -p > "$SCREENSHOT" 2>/dev/null

# ── Logcat error scan ────────────────────────────────────────────────────────
"$ADB" logcat -d -t 500 *:E ReactNativeJS:V 2>/dev/null \
  | grep -E "FATAL EXCEPTION|redbox|Unable to load script|Error: |bundleURL" \
  > "$LOGCAT_FILE" 2>/dev/null

SMOKE_STATUS="pass"
LOGCAT_RESULT="(none)"
if [[ -s "$LOGCAT_FILE" ]]; then
  SMOKE_STATUS="fail"
  LOGCAT_RESULT="$LOGCAT_FILE"
fi

# ── Classify diff for QA depth ───────────────────────────────────────────────
cd "$PROJECT_ROOT" 2>/dev/null || cd "$(dirname "$PROJECT_ROOT")" 2>/dev/null

CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null \
  || git status --porcelain 2>/dev/null | awk '{print $2}')

QA_RECOMMENDATION="smoke_only"
QA_REASON="no high-impact files changed"

FILE_COUNT=$(echo "$CHANGED_FILES" | grep -c . 2>/dev/null || echo 0)

if [[ "$FILE_COUNT" -ge 6 ]]; then
  QA_RECOMMENDATION="deep"
  QA_REASON="${FILE_COUNT} files changed"
elif echo "$CHANGED_FILES" | grep -qE \
    "app/_layout\.tsx|app/\(tabs\)/_layout\.tsx|^app/[^/]+\.tsx$"; then
  QA_RECOMMENDATION="deep"
  QA_REASON="navigation/layout file changed"
elif echo "$CHANGED_FILES" | grep -qE \
    "session\.tsx|src/db/|schema|migration|sqlite"; then
  QA_RECOMMENDATION="deep"
  QA_REASON="session screen or data layer changed"
elif echo "$CHANGED_FILES" | grep -qE \
    "src/utils/balance|src/hooks/useStudent|src/lib/"; then
  QA_RECOMMENDATION="deep"
  QA_REASON="core data/balance logic changed"
elif echo "$CHANGED_FILES" | grep -qE \
    "package\.json|app\.json"; then
  QA_RECOMMENDATION="deep"
  QA_REASON="dependencies or Expo config changed"
fi

# ── Emit structured block (Claude reads this) ─────────────────────────────
echo "" >&2
echo "[POST-BUILD]" >&2
echo "smoke: ${SMOKE_STATUS}" >&2
echo "screenshot: ${SCREENSHOT}" >&2
echo "logcat: ${LOGCAT_RESULT}" >&2
echo "files_changed:" >&2
echo "$CHANGED_FILES" | while IFS= read -r f; do
  [[ -n "$f" ]] && echo "  - $f" >&2
done
echo "qa_recommendation: ${QA_RECOMMENDATION}" >&2
echo "reason: ${QA_REASON}" >&2
echo "" >&2

exit 0
