# Android Emulator & QA Workflow

## Quick start

**Step 1 — Quit Android Studio completely** (saves ~2 GB RAM).

**Step 2 — Boot the lean emulator.** Run this in your terminal (the `&` keeps it running in the background):
```sh
./scripts/emulator-lean.sh &
```
Or type this directly into Claude Code as a message:
```
! ./scripts/emulator-lean.sh
```
The emulator window appears after ~30–60 s (cold boot). Wait until the home screen is fully visible.

**Step 3 — Build and run the app:**
```sh
cd hourbank && npm run android
```

After the build, a smoke test fires automatically. Claude reads the result and runs `/qa` if the diff warrants it.

---

## Emulators

| AVD | Resolution | Density | RAM | Use for |
|---|---|---|---|---|
| `Pixel5_Lean` | 1080×2340 | 420 dpi | 2 GB | Daily dev testing (default) |
| `Pixel_10_Pro_XL` | 1344×2992 | 480 dpi | 2 GB | Large-screen sanity checks only |

Boot a specific AVD:
```sh
./scripts/emulator-lean.sh Pixel_10_Pro_XL
```

**Rule:** Never open Android Studio while testing. Its process + gradle daemon alone hold ~2 GB.

---

## Post-build smoke test (automatic)

`scripts/post-build-smoke.sh` fires after every `npm run android` / `expo run:android` via the Claude PostToolUse hook. It:

1. Bails silently if no emulator is online or if the command wasn't a build
2. Launches the app via `adb shell monkey`
3. Waits 8 s, captures a screenshot → `/tmp/hourbank-smoke-<ts>.png`
4. Scans logcat for fatal errors → `/tmp/hourbank-logcat-<ts>.log`
5. Inspects the git diff and classifies QA depth
6. Emits a `[POST-BUILD]` block that Claude reads on the next turn

---

## QA escalation rules

Claude decides whether to auto-invoke `/qa` based on what changed:

**→ Deep `/qa` fires when the diff touches:**
- `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, or any new screen under `app/`
- `app/student/[id]/session.tsx` (timer / live session screen)
- `src/db/**`, anything with `schema`, `migration`, or `sqlite` in the name
- `src/utils/balance.ts`, `src/hooks/useStudent*.ts`, `src/lib/**`
- `package.json` or `app.json`
- `android/**` native config (non-generated)
- 6 or more files changed in one build

**→ Smoke-only when the diff is strictly:**
- `tailwind.config.js` colour/spacing tweaks
- Isolated cosmetic edits to a single non-critical component
- Copy/text changes, comments, markdown

When mixed or ambiguous: deep `/qa` wins — false positives are cheap, missed regressions are not.

**Override:** tell Claude "skip qa" before a build to force smoke-only regardless.

---

## Files

```
scripts/
  emulator-lean.sh        # lean AVD launcher (use instead of Android Studio)
  post-build-smoke.sh     # smoke test + QA classifier (called by Claude hook)
  README.md               # this file

.claude/settings.local.json  # PostToolUse hook wiring
~/.android/avd/
  Pixel5_Lean.ini
  Pixel5_Lean.avd/config.ini  # lean AVD definition
```

---

## Troubleshooting

**Emulator boots but app doesn't launch:**
```sh
adb devices                          # confirm emulator is online
adb shell pm list packages | grep hourbank   # confirm app is installed
adb logcat -d *:E | tail -30         # check for errors
```

**Screenshot is black / blank:**
The app may not have fully rendered in 8 s. Run the smoke script manually after confirming the app is visible:
```sh
adb exec-out screencap -p > /tmp/manual.png
```

**Hook not firing:**
Check `.claude/settings.local.json` has the `PostToolUse` entry. The hook bails silently if the build command string doesn't contain `expo run:android`, `gradlew`, or `npm run android`.
