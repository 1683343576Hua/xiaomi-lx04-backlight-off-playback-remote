#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ADB Bridge —— 给「小爱音箱 / Android 设备」提供 HTTP 遥控接口

把语音助手（如 MiGPT-Next）无法直接执行的动作，通过 ADB 转发到目标设备：
  - 发媒体键（播放/暂停/上一集/下一集）
  - 打开指定 App
  - 息屏播放（关闭 LCD 背光但保持系统清醒，音乐不断）

设计动机：
  语音助手常跑在 Docker 容器里，容器内没有 adb 可执行文件；
  宿主机有 adb，但未必有 Node。所以用 Python 标准库起一个极简 HTTP 服务，
  容器（host 网络）通过 HTTP 调宿主机 localhost 即可完成遥控。

只依赖 Python 3 标准库，无第三方依赖。
"""

import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

# ==================== 配置 ====================
# 优先读环境变量，其次用 config.json（与本脚本同目录），最后用这里的默认值。

DEFAULT_CONFIG = {
    # 目标设备（网络 ADB 地址，格式 IP:PORT 或设备序列号）
    "adb_device": "192.168.31.68:5555",
    # HTTP 监听地址与端口
    "listen_host": "127.0.0.1",
    "listen_port": 8099,
    # 媒体键映射（名称 -> Android keycode）
    "key_map": {
        "play_pause": 85,   # KEYCODE_MEDIA_PLAY_PAUSE
        "next": 87,         # KEYCODE_MEDIA_NEXT
        "previous": 88,     # KEYCODE_MEDIA_PREVIOUS
    },
    # App 映射（别名 -> 完整组件名 component）
    # 示例为小爱音箱上常见的第三方/魔改 App，请按你的设备实际替换
    "app_map": {
        "blbl": "blbl.cat3399/.ui.MainLauncherDarkAlias",
        "netease": "com.netease.cloudmusic.iot/com.netease.cloudmusic.audio.loading.IotLauncherActivity",
        "tvbox": "com.github.tvbox.osc.jun/com.github.tvbox.osc.ui.activity.HomeActivity",
    },
    # LCD 背光硬件节点（联发科 MT65xx 平台常见路径；其他平台可能不同，
    # 用 `adb shell "ls /sys/class/leds/"` 找 *backlight* 节点）
    "backlight_node": "/sys/class/leds/lcd-backlight/brightness",
    # 息屏时背光写入值 / 亮屏恢复值（0~255）
    "backlight_off": "0",
    "backlight_on": "255",
}

CONFIG = dict(DEFAULT_CONFIG)

# 环境变量覆盖（ADB_BRIDGE_<KEY>，KEY 大写）
for key in DEFAULT_CONFIG:
    env = os.environ.get("ADB_BRIDGE_" + key.upper())
    if env is not None:
        CONFIG[key] = env

# 环境变量覆盖嵌套 dict（key_map / app_map 支持 JSON 字符串）
for nested_key in ("key_map", "app_map"):
    env = os.environ.get("ADB_BRIDGE_" + nested_key.upper())
    if env:
        try:
            CONFIG[nested_key] = json.loads(env)
        except Exception:
            pass

# config.json 覆盖（与本脚本同目录）
_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
if os.path.exists(_CONFIG_PATH):
    try:
        with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
            file_cfg = json.load(f)
        for k, v in file_cfg.items():
            if v is not None:
                CONFIG[k] = v
    except Exception as e:
        print("[warn] 读取 config.json 失败，使用默认配置：", e)

# 类型归一：port 保证是 int
try:
    CONFIG["listen_port"] = int(CONFIG["listen_port"])
except Exception:
    CONFIG["listen_port"] = 8099

ADB_DEVICE = CONFIG["adb_device"]
KEY_MAP = CONFIG["key_map"]
APP_MAP = CONFIG["app_map"]
BACKLIGHT_NODE = CONFIG["backlight_node"]
BACKLIGHT_OFF = str(CONFIG["backlight_off"])
BACKLIGHT_ON = str(CONFIG["backlight_on"])


# ==================== ADB 操作 ====================

def ensure_connected():
    subprocess.run(
        ["adb", "connect", ADB_DEVICE],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
    )


def run_adb_key(keycode):
    """发送媒体键。"""
    ensure_connected()
    r = subprocess.run(
        ["adb", "-s", ADB_DEVICE, "shell", "input", "keyevent", str(keycode)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
    )
    return r.returncode == 0


def run_open_app(component):
    """打开指定 App（am start）。"""
    ensure_connected()
    r = subprocess.run(
        ["adb", "-s", ADB_DEVICE, "shell", "am", "start", "-n", component],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15,
    )
    out = (r.stdout + r.stderr).decode("utf-8", "ignore")
    # am start 成功时 stdout 含 "Starting: Intent"，失败含 "Error"
    ok = ("Error" not in out) and ("Starting" in out or "Activity" in out)
    return ok


def run_screen(state):
    """息屏播放 / 亮屏。

    核心思想：只关闭 LCD 背光硬件，不让系统进入休眠（Asleep/SCREEN_OFF）。
    —— 小爱等设备原生的「息屏/锁屏」会让系统休眠并挂起前台音频，导致音乐停；
    而直接写背光节点可以让屏幕全黑的同时系统保持 Awake，音乐继续播放。

    注意：写背光必须在系统稳定时进行（不要紧接着唤醒动作/亮度变更），
    否则会被 LightService 刷回屏幕亮度映射值。亮屏前先发 KEYCODE_WAKEUP
    兜底（万一息屏期间误按了物理锁屏键导致系统休眠）。
    """
    ensure_connected()
    if state == "on":
        # 先唤醒系统（若已 Awake 则无害），再写背光
        subprocess.run(
            ["adb", "-s", ADB_DEVICE, "shell", "input", "keyevent", "224"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
        )
    val = BACKLIGHT_OFF if state == "off" else BACKLIGHT_ON
    r = subprocess.run(
        ["adb", "-s", ADB_DEVICE, "shell",
         "echo", val, ">", BACKLIGHT_NODE],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
    )
    return r.returncode == 0


# ==================== HTTP 服务 ====================

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", "ignore")
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        # /key 发媒体键
        if self.path == "/key":
            key = data.get("key", "")
            code = KEY_MAP.get(key)
            if code is None:
                self._reply(400, {"ok": False, "error": "unknown key: " + key})
                return
            ok = run_adb_key(code)
            self._reply(200, {"ok": ok, "key": key, "keycode": code})
            return

        # /open 打开 App
        if self.path == "/open":
            app = data.get("app", "")
            comp = APP_MAP.get(app)
            if comp is None:
                self._reply(400, {"ok": False, "error": "unknown app: " + app})
                return
            ok = run_open_app(comp)
            self._reply(200, {"ok": ok, "app": app})
            return

        # /screen 息屏/亮屏（关背光但保持 Awake，音乐不断）
        if self.path == "/screen":
            state = data.get("state", "")
            if state not in ("on", "off"):
                self._reply(400, {"ok": False, "error": "unknown state: " + state})
                return
            ok = run_screen(state)
            self._reply(200, {"ok": ok, "state": state})
            return

        self._reply(404, {"ok": False, "error": "not found"})

    def do_GET(self):
        if self.path == "/health":
            self._reply(200, {"ok": True})
        else:
            self._reply(404, {"ok": False, "error": "not found"})

    def _reply(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer((CONFIG["listen_host"], CONFIG["listen_port"]), Handler)
    print("ADB bridge listening on %s:%s (device=%s)"
          % (CONFIG["listen_host"], CONFIG["listen_port"], ADB_DEVICE))
    server.serve_forever()
