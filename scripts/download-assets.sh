#!/usr/bin/env bash
# Downloads the Figma assets into public/images.
# These Figma URLs are temporary (about 7 days). If they expire, ask Claude to regenerate this script.
set -euo pipefail
cd "$(dirname "$0")/../public/images"
P="https://www.figma.com/api/mcp/asset/649c2924-ba39-42aa-b5ea-d583899d37dc"
curl -fL "$P/d4dfd.png" -o fire-dancer-1.png
curl -fL "$P/76a20.png" -o fire-dancer-2.png
curl -fL "$P/1724c.png" -o rock-concert.png
curl -fL "$P/388c6.png" -o castle.png
curl -fL "$P/35713.svg" -o arrow-1.svg
curl -fL "$P/85556.svg" -o arrow-2.svg
curl -fL "$P/b1ac4.svg" -o logo.svg
echo "Done. Files in public/images:" && ls -l
