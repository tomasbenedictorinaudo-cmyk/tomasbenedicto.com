#!/bin/sh
# Regenerate the downloadable CV from cv.html's print layout (two A4 pages).
# usage: sh tools/make-cv-pdf.sh   (needs a Chromium: Playwright's headless shell, Chrome or Chromium)
cd "$(dirname "$0")/.." || exit 1
for c in "$CHROME" \
  "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
  [ -n "$c" ] && [ -x "$c" ] && CH="$c" && break
done
[ -z "$CH" ] && { echo "No Chromium found; set CHROME=/path/to/chrome" >&2; exit 1; }
"$CH" --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=5000 \
  --print-to-pdf="assets/Tomas-Benedicto-Rinaudo-CV.pdf" "file://$PWD/cv.html" 2>/dev/null
echo "assets/Tomas-Benedicto-Rinaudo-CV.pdf"
