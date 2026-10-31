#!/bin/bash
set -e
cd -- "$(dirname -- "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo '需要先安装 Python 3；也可尝试直接双击 index.html。'
  read -r -p '按 Enter 退出。'
  exit 1
fi
exec python3 start-local.py
