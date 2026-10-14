#!/usr/bin/env bash
# Usage: ./release.sh <new-version>     e.g. ./release.sh 0.2.1
# Needs: gh (authenticated), web-ext (npm i -g web-ext), python3, env AMO_JWT_ISSUER / AMO_JWT_SECRET.
set -euo pipefail
VERSION="${1:?usage: ./release.sh <version>}"
REPO="JoshuaJackK/grok-folders"
ID="grok-folders@joshuajackk.github.io"
IGNORE=("tests/**" README.md RELEASING.md release.sh updates.json .gitignore)
cd "$(dirname "$0")"

: "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER}"; : "${AMO_JWT_SECRET:?set AMO_JWT_SECRET}"
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree not clean"; exit 1; }
git pull --ff-only

# 1) bump version
python3 - "$VERSION" <<'PY'
import json, sys
p = "manifest.json"; m = json.load(open(p)); m["version"] = sys.argv[1]
open(p, "w").write(json.dumps(m, indent=2) + "\n")
PY

# 2) tests + lint
for t in tests/*.test.js; do node "$t"; done   # ui.test.js needs jsdom (NODE_PATH or npm i jsdom), otherwise SKIPs
web-ext lint --self-hosted --ignore-files "${IGNORE[@]}"

# 3) sign (unlisted, self-distributed)
rm -rf web-ext-artifacts
web-ext sign --channel=unlisted --api-key="$AMO_JWT_ISSUER" --api-secret="$AMO_JWT_SECRET" \
  --ignore-files "${IGNORE[@]}" --approval-timeout 900000
XPI=$(ls web-ext-artifacts/*.xpi | head -1)
ASSET="grok-folders-$VERSION.xpi"
cp "$XPI" "web-ext-artifacts/$ASSET"

# 4) commit version, tag, release
git add manifest.json
git commit -m "Release $VERSION"
git tag "v$VERSION"
git push origin main "v$VERSION"
gh release create "v$VERSION" "web-ext-artifacts/$ASSET" -R "$REPO" -t "v$VERSION" -n "Grok Folders $VERSION (signed, unlisted)"
URL="https://github.com/$REPO/releases/download/v$VERSION/$ASSET"

# 5) update manifest for Firefox auto-update
python3 - "$ID" "$VERSION" "$URL" "web-ext-artifacts/$ASSET" <<'PY'
import json, sys, hashlib
aid, ver, url, xpi = sys.argv[1:]
d = json.load(open("updates.json"))
ups = d.setdefault("addons", {}).setdefault(aid, {}).setdefault("updates", [])
ups[:] = [u for u in ups if u.get("version") != ver]
ups.append({"version": ver, "update_link": url,
            "update_hash": "sha256:" + hashlib.sha256(open(xpi, "rb").read()).hexdigest()})
open("updates.json", "w").write(json.dumps(d, indent=2) + "\n")
PY
git add updates.json
git commit -m "updates.json: $VERSION"
git push origin main

# 6) verify
sleep 5
for u in "$URL" "https://raw.githubusercontent.com/$REPO/main/updates.json"; do
  echo "$(curl -sL -o /dev/null -w '%{http_code}' "$u")  $u"
done
