import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const port = Number(process.env.PORT || 3001);
const apiKeyPath = process.env.QIANWEN_API_KEY_FILE || join(process.cwd(), "QianWen-API");
const model = process.env.QIANWEN_MODEL || "qwen-plus";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function loadCredentials() {
  const raw = await readFile(apiKeyPath, "utf8");
  const apiKey = raw.match(/sk-[A-Za-z0-9]+/)?.[0];
  const endpoint =
    process.env.QIANWEN_ENDPOINT || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

  if (!apiKey) {
    throw new Error("QianWen-API 文件中没有找到有效的 API key。");
  }

  return { apiKey, endpoint };
}

function buildSystemPrompt({ scenario, role, profile }) {
  return [
    "你是 OfferForge 的 AI 模拟面试官，目标是帮助大三学生进行面试训练。",
    `当前训练场景：${scenario || "通用面试"}`,
    `用户目标方向：${role || "未填写"}`,
    profile ? `用户背景：${profile}` : "用户背景：暂未填写。",
    "请用中文交流。每轮回复保持精炼，优先提出一个具体追问；必要时给出一句可执行的改进建议。",
    "不要一次性给出长篇题库。保持真实面试官风格，围绕用户回答继续追问。",
  ].join("\n");
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => ["user", "assistant"].includes(message?.role) && typeof message.content === "string")
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 4000),
    }))
    .slice(-12);
}

async function handleChat(request, response) {
  try {
    const body = await readJson(request);
    const messages = validateMessages(body.messages);

    if (!messages.length) {
      response.writeHead(400, jsonHeaders);
      response.end(JSON.stringify({ error: "缺少有效的对话内容。" }));
      return;
    }

    const { apiKey, endpoint } = await loadCredentials();
    const upstreamResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [{ role: "system", content: buildSystemPrompt(body) }, ...messages],
      }),
    });

    const upstreamData = await upstreamResponse.json().catch(() => ({}));

    if (!upstreamResponse.ok) {
      response.writeHead(upstreamResponse.status, jsonHeaders);
      response.end(
        JSON.stringify({
          error: upstreamData?.message || upstreamData?.error?.message || "千问 API 请求失败。",
        }),
      );
      return;
    }

    const reply = upstreamData?.choices?.[0]?.message?.content;
    response.writeHead(200, jsonHeaders);
    response.end(JSON.stringify({ reply: reply || "模型没有返回文本内容。" }));
  } catch (error) {
    response.writeHead(500, jsonHeaders);
    response.end(JSON.stringify({ error: error.message || "服务器内部错误。" }));
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, jsonHeaders);
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && request.url === "/api/chat") {
    handleChat(request, response);
    return;
  }

  response.writeHead(404, jsonHeaders);
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OfferForge API listening on http://127.0.0.1:${port}`);
});
