# 小爱触屏音箱 LX04 · 息屏后台播放 + 语音模拟遥控

> 让小爱触屏音箱（LX04 等 Android 设备）**用语音操作第三方 App**，并实现**「息屏但系统正常运行、音乐继续播」**——这两件事小爱原生语音都做不到。

**核心机制**：不触发系统锁屏休眠，直接改写 **LCD 背光硬件节点**，让屏幕全黑的同时系统保持清醒运行，音频/前台服务不受影响。区别于普通息屏（锁屏→停播）和「亮度调 0」（LCD 漏光不够黑）。

---

## 💡 为什么开发这个程序？

刷完破解系统的用户会安装自己需要的媒体或者应用型app，在使用第三方 App 时，小爱原生语音无法操控这些 App 的常用功能——**视频播放/暂停、上一集、下一集**等都控制不了（小爱自带语音只能控制自家播放器）。

同时，当视频 App 或其他 App 运行时，音箱屏幕会**一直亮着**，晚上很影响睡眠；而小爱原生的「息屏」「关闭屏幕」又会导致 App 停止播放。

本项目解决这两个痛点：

1. **模拟遥控输入**：通过 ADB 发安卓标准媒体键，用语音实现「播放/暂停、上一集、下一集」等操作，控制第三方 App。
2. **关闭硬件屏幕但不影响系统锁屏判定**：直接关断 LCD 背光硬件，屏幕全黑，但系统不进入锁屏休眠，App 继续正常运行播放。

上述功能都能通过「小爱同学」语音实现。其中「息屏但系统仍运行」的预设指令为：

> **「小爱同学，息屏播放」**，或同义词「**黑屏播放**」「**后台播放**」

之所以用这些词，是为了避免和小爱原生的「息屏」「关闭屏幕」等指令冲突（那些会让系统真正锁屏并停止播放）。

---

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 🌙 息屏后台播放 | 「息屏播放」→ 屏幕全黑，系统正常运行，音乐/视频继续播 |
| ☀️ 亮屏 | 「亮屏」→ 恢复显示，全程不断播 |
| 🎮 模拟遥控输入 | 「下一集 / 上一集 / 播放 / 暂停」→ 发安卓媒体键 |
| 📱 语音打开 App | 「打开B站 / 打开网易云 / 打开电视」→ 打开指定组件 |

---

## 🧠 核心原理：为什么「息屏」能不停播？

三种「息屏」方式的本质区别：

| 方式 | 系统状态 | 屏幕 | 音乐 |
|------|---------|------|------|
| 普通息屏（电源键/锁屏/小爱原生「关闭屏幕」） | 进入休眠 `Asleep` | 黑 | ❌ 停 |
| 亮度调 0（`screen_brightness=0`） | 清醒 `Awake` | 仍漏光 | ✅ 播 |
| **本项目：直接写背光硬件节点** | 保持清醒 `Awake` | **真黑** | ✅ 播 |

- **普通息屏**会让系统进入休眠（`Asleep`），而小爱 ROM 会在休眠时**挂起前台音频** → 屏幕黑了，歌也停了。
- **亮度调 0** 不行：LX04 是 **LCD 屏**，ROM 亮度映射有最小值下限，设 0 时背光仍漏光，晚上依然刺眼。
- **本项目**直接写背光硬件节点，绕过系统亮度映射和锁屏流程：

```
息屏：echo 0 > /sys/class/leds/lcd-backlight/brightness    # 背光断电=真黑屏，系统保持 Awake
亮屏：echo 255 > /sys/class/leds/lcd-backlight/brightness  # 恢复背光
```

系统全程保持 `Awake`（清醒、正常运行），音频/前台服务不被挂起，所以**音乐一直播**。

> ⚠️ 关键约束：写背光必须在系统「稳定」时进行（不要紧跟唤醒动作或亮度变更），否则会被系统的亮度服务（LightService）刷回。息屏播放场景天然满足——用户说「息屏播放」时正在播歌，系统本就清醒且稳定。

---

## 🏗 架构

```
用户语音「小爱同学，息屏播放」
        │
        ▼
MiGPT-Next 容器 (config.js 补丁)
        │  命中指令，HTTP POST → 127.0.0.1:8099
        ▼
宿主机 adb-bridge.py (systemd 服务，监听 8099)
        │  翻译成 adb shell 命令
        ▼
adb -s <设备IP>:5555 shell ...   （发给音箱）
```

**为什么要拆一层 HTTP 中转？** 语音助手常跑在 Docker 容器里，容器内没有 `adb` 可执行文件；宿主机有 adb 但未必装 Node。于是用 Python 标准库起个极简 HTTP 服务做桥，容器（host 网络）直接 HTTP 调宿主机 localhost 即可。

---

## 📁 目录结构

```
.
├── adb-bridge/
│   ├── adb-bridge.py          # ADB 中转服务（唯一核心程序）
│   └── config.example.json    # 配置示例（改名 config.json 生效）
├── examples/
│   ├── migpt-config.patch.js  # MiGPT-Next 的 config.js 补丁片段
│   └── config.example.js      # 完整整合参考示例
├── systemd/
│   └── adb-bridge.service     # systemd 服务文件
├── install.sh                 # 一键安装脚本
├── LICENSE                    # MIT
└── README.md
```

---

## 🚀 快速开始

### 前置条件

1. 设备已开启**网络 ADB**（小爱音箱可用 Sky ADB 等工具开启，或用 USB 调试后 `adb tcpip 5555`）。
2. 宿主机（Linux，能跑 Docker 和 adb）与设备同一局域网。

### 第 1 步：安装 adb-bridge

```bash
git clone https://github.com/<你的用户名>/xiaomi-lx04-backlight-off-playback-remote.git
cd xiaomi-lx04-backlight-off-playback-remote
sudo bash install.sh
```

验证：

```bash
curl -s http://127.0.0.1:8099/health   # 应返回 {"ok": true}
```

### 第 2 步：配置设备

编辑 `/opt/adb-bridge/config.json`（或环境变量），改 `adb_device` 为你的设备地址，`app_map` 改为你的 App 组件名：

```json
{
  "adb_device": "192.168.31.68:5555",
  "app_map": {
    "blbl": "blbl.cat3399/.ui.MainLauncherDarkAlias",
    "netease": "com.netease.cloudmusic.iot/..."
  }
}
```

> 查设备组件名：`adb shell "dumpsys activity activities | grep ResumedActivity"`（打开目标 App 后查看）。
> 查背光节点：`adb shell "ls /sys/class/leds/ /sys/class/backlight/"`，找含 `backlight` 的项。

改完重启：`sudo systemctl restart adb-bridge`

### 第 3 步：接入 MiGPT-Next

1. 确认 MiGPT-Next 容器是 `network_mode: host`。
2. 把 `examples/migpt-config.patch.js` 里的三段代码按注释粘贴进你的 `config.js`。
3. 重启 MiGPT-Next。

### 第 4 步：测试

```bash
# 直接测中转服务（不经过语音）
curl -X POST http://127.0.0.1:8099/key    -H "Content-Type: application/json" -d '{"key":"next"}'
curl -X POST http://127.0.0.1:8099/open   -H "Content-Type: application/json" -d '{"app":"blbl"}'
curl -X POST http://127.0.0.1:8099/screen -H "Content-Type: application/json" -d '{"state":"off"}'
```

然后对小爱说：「小爱同学，下一集」「小爱同学，息屏播放」等。

---

## 🔌 HTTP 接口

| 端点 | 方法 | 请求体 | 作用 |
|------|------|--------|------|
| `/key` | POST | `{"key":"next" / "previous" / "play_pause"}` | 模拟遥控按键 |
| `/open` | POST | `{"app":"blbl" / "netease" / "tvbox"}` | 打开 App |
| `/screen` | POST | `{"state":"off" / "on"}` | 息屏 / 亮屏 |
| `/health` | GET | - | 健康检查 |

`key` 和 `app` 的可取值由 `config.json` 的 `key_map` / `app_map` 定义，可自由扩展。

---

## 🎙 语音指令清单（默认）

| 指令 | 动作 |
|------|------|
| 息屏播放 / 黑屏播放 / 后台播放 | 关背光（系统正常运行，不停播） |
| 亮屏 / 开屏 / 点亮屏幕 | 恢复背光 |
| 下一集 / 下一首 / 下一个 | 媒体键「下一集」 |
| 上一集 / 上一首 / 上一个 | 媒体键「上一集」 |
| 播放 / 继续 / 暂停 | 媒体键「播放/暂停」 |
| 打开B站 / 打开网易云 / 打开电视 | 打开对应 App |

> 在 `examples/migpt-config.patch.js` 的 `remoteMap` 里可自定义词语。

---

## 🛠 适配你自己的设备

不同设备关键差异就三处，改 `config.json` 即可：

1. **`adb_device`** — 设备网络 ADB 地址。
2. **`app_map`** — App 组件名（你的第三方 App 大概率不同，见上「查组件名」）。
3. **`backlight_node`** — LCD 背光节点路径。联发科 MT65xx 平台是 `/sys/class/leds/lcd-backlight/brightness`；高通等其他平台可能是 `/sys/class/backlight/xxx/brightness`。用 `adb shell "ls /sys/class/leds/ /sys/class/backlight/"` 找。

---

## ❓ FAQ

**Q：息屏后音乐还是停了？**
大概率是误按了物理锁屏键导致系统进入休眠（会挂起音频）。正常流程是全程用语音「息屏播放」/「亮屏」，不要碰物理键。可用 `adb shell "dumpsys power | grep mWakefulness"` 查看：`Awake`=清醒（不停播），`Asleep`=休眠（会停播）。

**Q：写背光后又被刷回？**
是因为紧接着触发了唤醒动作或亮度变更。在系统稳定时写背光即可。亮屏逻辑已内置「先唤醒再写背光」兜底。

**Q：控制不了我的 App？**
媒体键对多数音视频 App 通用；「打开 App」需确认 `app_map` 里的组件名正确（`am start -n 组件名` 能成功启动）。

**Q：能控制其他设备吗？**
可以，任何支持网络 ADB 的 Android 设备都能用 `/key` 和 `/open`；息屏播放取决于有没有可写的背光节点。

---

## 📄 许可

MIT License

## 🙏 致谢

- [MiGPT-Next](https://github.com/idootop/migpt-next) — 小爱音箱接入大模型的底座。
- 本项目最初为个人小爱触屏音箱（LX04，联发科 MT65xx 平台）定制，泛化后开源。

---

> 提示：本 README 中的默认 IP、App 包名等均为示例，请替换为你自己的设备信息后再发布。
