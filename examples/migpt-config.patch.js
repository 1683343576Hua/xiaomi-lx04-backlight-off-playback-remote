// ====================================================================
// MiGPT-Next config.js 补丁片段 —— 语音遥控 + 息屏播放
// ====================================================================
//
// 使用方法：把本文件中的三段代码，按下面的说明粘贴到你的 config.js 对应位置。
// 完整示例见同目录 config.example.js。
//
// 依赖：宿主机已运行 adb-bridge.py（见 ../adb-bridge/），并确保容器为 host 网络，
//       能访问宿主机的 127.0.0.1:8099。
// ====================================================================

// ---------- 第 1 段：HTTP 转发函数（放在文件顶部、MiGPT 实例创建之前） ----------
// 调宿主机上的 adb-bridge 服务，由它执行 adb 给音箱发媒体键/打开 App/息屏。
import http from "node:http";

function adbRequest(path, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: 8099, // adb-bridge 监听端口
        path: path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ ok: false, error: "parse error" });
          }
        });
      }
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.write(data);
    req.end();
  });
}

function sendAdbKey(key) {
  return adbRequest("/key", { key });
}

function openApp(app) {
  return adbRequest("/open", { app });
}

function screenControl(state) {
  return adbRequest("/screen", { state });
}

// ---------- 第 2 段：onMessage 开头的遥控指令匹配 ----------
// 粘贴到 `async onMessage(engine, msg) {` 之后、你原有的逻辑之前。
// 命中遥控指令时：停掉小爱 → 执行 ADB 动作 → 播报「好的」→ return（不走大模型）。
async function handleRemoteCommand(engine, msg) {
  const raw = (msg.text || "").trim();
  const norm = raw.replace(/[，。！？!?\s]+/g, "");

  // 遥控指令映射：语音词 -> [动作类型, 参数]
  const remoteMap = {
    // 媒体键（播放控制）
    "下一集": ["key", "next"], "下一首": ["key", "next"], "下一个": ["key", "next"],
    "上一集": ["key", "previous"], "上一首": ["key", "previous"], "上一个": ["key", "previous"],
    "播放": ["key", "play_pause"], "继续": ["key", "play_pause"], "继续播放": ["key", "play_pause"],
    "暂停": ["key", "play_pause"], "停止播放": ["key", "play_pause"],
    // 打开 App（别名按你的设备实际替换）
    "打开B站": ["open", "blbl"], "打开b站": ["open", "blbl"], "打开哔站": ["open", "blbl"],
    "打开哔哩哔哩": ["open", "blbl"], "打开blbl": ["open", "blbl"], "打开bilibili": ["open", "blbl"],
    "打开网易云": ["open", "netease"], "打开网易云音乐": ["open", "netease"],
    "打开电视": ["open", "tvbox"], "打开tvbox": ["open", "tvbox"], "打开TVBox": ["open", "tvbox"],
    // 息屏播放（关背光不停播） / 亮屏
    "息屏播放": ["screen", "off"], "黑屏播放": ["screen", "off"], "后台播放": ["screen", "off"],
    "亮屏": ["screen", "on"], "开屏": ["screen", "on"], "点亮屏幕": ["screen", "on"],
  };

  const cmd = remoteMap[norm];
  if (!cmd) return false; // 不是遥控指令，交给后续逻辑

  const [kind, arg] = cmd;
  console.log("遥控指令命中：「" + raw + "」→ " + kind + ":" + arg);
  await engine.MiNA.stop(); // 停掉小爱（官方 abortXiaoAI 是空实现）

  let res;
  if (kind === "key") {
    res = await sendAdbKey(arg);
  } else if (kind === "open") {
    res = await openApp(arg);
  } else {
    res = await screenControl(arg);
  }
  console.log("  ADB 转发结果：", JSON.stringify(res));

  // 简短播报反馈（避免音箱完全没反应）
  await engine.MiOT.doAction(5, 1, "好的");
  return true; // 已处理，调用方直接 return
}

// ---------- 第 3 段：onMessage 里调用上面函数 ----------
// 在你的 `async onMessage(engine, msg) {` 函数体开头加这一行：
//
//   if (await handleRemoteCommand(engine, msg)) return;
//
// 这样遥控指令会在进入大模型逻辑前被拦截。
// ====================================================================
