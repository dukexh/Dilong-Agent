#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo '需要安装 Python 3；开发也可使用 npm run dev。请先完成 npm ci 和 npm run build。'
  read -r -p '按 Enter 退出。'
  exit 1
fi
exec python3 start-local.py
