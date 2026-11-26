/**
 * ====================================================================
 * MiGPT-Next config.js 完整参考示例（含语音遥控 + 息屏播放）
 * ====================================================================
 * 这不是可直接运行的完整配置，只展示「ADB 遥控」相关的完整整合方式，
 * 供你对照自己的 config.js 参考。你的千问 API、登录凭证等请保留原样。
 * ====================================================================
 */

import http from "node:http";
import { MiGPT } from "@mi-gpt/next";

// ============ ADB 转发（媒体键 + 打开 App + 息屏播放）============
// 调宿主机上的 adb-bridge 服务（127.0.0.1:8099）。
// 容器必须为 host 网络，才能访问宿主机 localhost。
function adbRequest(path, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: "127.0.0.1",
        port: 8099,
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

// ============ 遥控指令匹配（在 onMessage 开头调用）============
async function handleRemoteCommand(engine, msg) {
  const raw = (msg.text || "").trim();
  const norm = raw.replace(/[，。！？!?\s]+/g, "");

  const remoteMap = {
    "下一集": ["key", "next"], "下一首": ["key", "next"], "下一个": ["key", "next"],
    "上一集": ["key", "previous"], "上一首": ["key", "previous"], "上一个": ["key", "previous"],
    "播放": ["key", "play_pause"], "继续": ["key", "play_pause"], "继续播放": ["key", "play_pause"],
    "暂停": ["key", "play_pause"], "停止播放": ["key", "play_pause"],
    "打开B站": ["open", "blbl"], "打开b站": ["open", "blbl"], "打开哔站": ["open", "blbl"],
    "打开哔哩哔哩": ["open", "blbl"], "打开blbl": ["open", "blbl"], "打开bilibili": ["open", "blbl"],
    "打开网易云": ["open", "netease"], "打开网易云音乐": ["open", "netease"],
    "打开电视": ["open", "tvbox"], "打开tvbox": ["open", "tvbox"], "打开TVBox": ["open", "tvbox"],
    "息屏播放": ["screen", "off"], "黑屏播放": ["screen", "off"], "后台播放": ["screen", "off"],
    "亮屏": ["screen", "on"], "开屏": ["screen", "on"], "点亮屏幕": ["screen", "on"],
  };

  const cmd = remoteMap[norm];
  if (!cmd) return false;

  const [kind, arg] = cmd;
  console.log("遥控指令命中：「" + raw + "」→ " + kind + ":" + arg);
  await engine.MiNA.stop();

  let res;
  if (kind === "key") {
    res = await sendAdbKey(arg);
  } else if (kind === "open") {
    res = await openApp(arg);
  } else {
    res = await screenControl(arg);
  }
  console.log("  ADB 转发结果：", JSON.stringify(res));

  await engine.MiOT.doAction(5, 1, "好的");
  return true;
}

// ============ MiGPT 主配置 ============
async function main() {
  const client = MiGPT.create({
    // ... 你的登录凭证、千问 API 等配置，保持原样 ...

    callAIKeywords: ["帮我", "千问"], // 你的触发词

    async onMessage(engine, msg) {
      // ★ 遥控指令优先拦截：命中则直接执行，不走大模型
      if (await handleRemoteCommand(engine, msg)) return;

      // ... 你的其余对话逻辑 ...
    },
  });

  await client.start();
}

main();
