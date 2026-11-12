#!/usr/bin/env zsh
# Boot Pixel5_Lean (or any AVD passed as $1) with low-overhead flags.
# Run this INSTEAD of Android Studio — never open Android Studio while testing.
# Android Studio alone holds ~2 GB and its gradle daemon competes for RAM.

AVD="${1:-Pixel5_Lean}"
EMULATOR="$HOME/Library/Android/sdk/emulator/emulator"

if [[ ! -x "$EMULATOR" ]]; then
  echo "emulator not found at $EMULATOR" >&2
  exit 1
fi

exec "$EMULATOR" \
  -avd "$AVD" \
  -gpu host \
  -no-snapshot-save \
  -no-boot-anim \
  -netdelay none \
  -netspeed full
