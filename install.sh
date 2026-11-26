#!/usr/bin/env bash
# ====================================================================
# adb-bridge 一键安装脚本（Debian/Ubuntu，需 sudo）
# 用法：sudo bash install.sh
# ====================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/adb-bridge}"
SERVICE_NAME="adb-bridge"

echo "==> 检查依赖（adb / python3）..."
if ! command -v adb >/dev/null 2>&1; then
  echo "    未找到 adb，正在安装 android-tools-adb ..."
  apt-get update -y >/dev/null
  apt-get install -y android-tools-adb
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "    未找到 python3，正在安装 ..."
  apt-get install -y python3
fi

echo "==> 复制程序到 ${INSTALL_DIR} ..."
mkdir -p "${INSTALL_DIR}"
cp "$(dirname "$0")/adb-bridge/adb-bridge.py" "${INSTALL_DIR}/adb-bridge.py"
chmod +x "${INSTALL_DIR}/adb-bridge.py"

# 若存在 config.json 则一并复制（否则用户可自行创建）
if [ -f "$(dirname "$0")/adb-bridge/config.json" ]; then
  cp "$(dirname "$0")/adb-bridge/config.json" "${INSTALL_DIR}/config.json"
else
  cp "$(dirname "$0")/adb-bridge/config.example.json" "${INSTALL_DIR}/config.example.json"
  echo "    已复制 config.example.json，请按需改名为 config.json 并修改设备 IP"
fi

echo "==> 安装 systemd 服务 ..."
cp "$(dirname "$0")/systemd/adb-bridge.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

sleep 1
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  echo "==> 安装成功！服务已启动。"
  echo "    健康检查：curl -s http://127.0.0.1:8099/health"
else
  echo "==> 服务启动失败，请检查：systemctl status ${SERVICE_NAME}"
  exit 1
fi
