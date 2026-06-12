#!/usr/bin/env bash
# 생성된 일러스트 에셋을 다운로드하고 (브라우저 캔버스로) 최적화하여 assets/img/ 에 배치한다.
# 사용법: bash tools/fetch-assets.sh   (playwright 글로벌 설치 필요 시 NODE_PATH 지정)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p /tmp/sam3-assets assets/img
python3 - <<'PY'
import json, subprocess, sys
items = json.load(open('tools/assets-manifest.json'))
manifest = []
for it in items:
    src = f"/tmp/sam3-assets/{it['name']}.png"
    r = subprocess.run(['curl', '-sf', it['url'], '-o', src])
    if r.returncode != 0:
        print(f"FAIL {it['name']}: download error", file=sys.stderr); sys.exit(1)
    manifest.append({'src': src, 'out': f"assets/img/{it['name']}.jpg", 'maxW': it['maxW'], 'quality': it['quality']})
json.dump(manifest, open('/tmp/sam3-assets/opt.json', 'w'))
print('downloaded', len(manifest))
PY
NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}" node tools/optimize.js /tmp/sam3-assets/opt.json
echo DONE
