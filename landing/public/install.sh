#!/bin/sh
# PingAsk installer: curl -fsSL pingask.app/install.sh | sh
#
# Downloads the latest signed DMG from GitHub Releases, copies PingAsk.app into
# /Applications and cleans up after itself. Nothing else is touched.

set -eu

REPO="tanlethanh/pingask"
API="https://api.github.com/repos/$REPO/releases/latest"
APPS="/Applications"

die() {
  printf '\033[31merror\033[0m %s\n' "$1" >&2
  exit 1
}

info() {
  printf '\033[2m==>\033[0m %s\n' "$1"
}

[ "$(uname -s)" = "Darwin" ] || die "PingAsk is macOS only."

case "$(uname -m)" in
  arm64) ARCH="aarch64" ;;
  x86_64) ARCH="x64" ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

info "Looking up the latest release…"
RELEASE=$(curl -fsSL "$API") || die "could not reach the GitHub API."

# Releases ship one universal DMG. The per-arch lookup stays as a fallback in case a
# future build splits them again.
URL=$(printf '%s' "$RELEASE" | grep -o 'https://[^"]*_universal\.dmg' | head -n 1)
[ -n "$URL" ] || URL=$(printf '%s' "$RELEASE" | grep -o "https://[^\"]*_${ARCH}\.dmg" | head -n 1)
[ -n "$URL" ] || die "no macOS DMG in the latest release. See https://github.com/$REPO/releases"

TMP=$(mktemp -d)
MNT=""
cleanup() {
  [ -n "$MNT" ] && hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

info "Downloading $(basename "$URL")…"
curl -fL# "$URL" -o "$TMP/pingask.dmg" || die "download failed."

info "Mounting…"
MNT="$TMP/mnt"
mkdir -p "$MNT"
hdiutil attach "$TMP/pingask.dmg" -mountpoint "$MNT" -nobrowse -quiet || die "could not mount the DMG."

APP=$(find "$MNT" -maxdepth 1 -name "*.app" -print -quit)
[ -n "$APP" ] || die "no .app inside the DMG."

# A running copy cannot be replaced in place.
pkill -x PingAsk >/dev/null 2>&1 || true

info "Installing to ${APPS}…"
rm -rf "$APPS/$(basename "$APP")"
if ! ditto "$APP" "$APPS/$(basename "$APP")" 2>/dev/null; then
  info "Needs your password to write to $APPS."
  sudo ditto "$APP" "$APPS/$(basename "$APP")" || die "copy to $APPS failed."
  sudo chown -R "$(id -u):$(id -g)" "$APPS/$(basename "$APP")" || true
fi

xattr -dr com.apple.quarantine "$APPS/$(basename "$APP")" >/dev/null 2>&1 || true

printf '\n\033[32m✓\033[0m PingAsk installed.\n'
printf '  Launch it:  open -a PingAsk\n'
printf '  Then press: Control P\n\n'
