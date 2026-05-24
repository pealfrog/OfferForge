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

function buildSystemPrompt({ trainingMode, scenario, role, profile, resume }) {
  const prompt = [
    "你是 OfferForge 的 AI 模拟面试官，目标是帮助大三学生进行面试训练。",
    `训练方向：${trainingMode === "resume" ? "针对简历的提问和追问" : "通用型面试问题"}`,
    `当前训练场景：${scenario || "通用面试"}`,
    `用户目标方向：${role || "未填写"}`,
    profile ? `用户背景：${profile}` : "用户背景：暂未填写。",
  ];

  if (trainingMode === "resume") {
    prompt.push(
      "你正在进行简历追问训练。请优先基于简历内容提出具体、尖锐但合理的问题。",
      resume?.activeSection ? `当前网页高亮的简历片段：${resume.activeSection}` : "当前没有高亮片段。",
      resume?.text ? `简历全文：${resume.text}` : "用户尚未上传简历。",
      "如果有高亮片段，请围绕该片段提问；如果没有高亮片段，请从简历中选择最值得追问的一处，并在问题中自然指出依据。",
      "问题应帮助用户判断：简历是否写得清楚、回答是否能支撑简历表述。",
    );
  }

  prompt.push(
    "请用中文交流。每轮回复保持精炼，优先提出一个具体追问；必要时给出一句可执行的改进建议。",
    "不要一次性给出长篇题库。保持真实面试官风格，围绕用户回答继续追问。",
  );

  return prompt.join("\n");
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

async function callQianwen(messages, options = {}) {
  const { apiKey, endpoint } = await loadCredentials();
  const upstreamResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.7,
      messages,
    }),
  });
  const upstreamData = await upstreamResponse.json().catch(() => ({}));

  if (!upstreamResponse.ok) {
    const error = new Error(upstreamData?.message || upstreamData?.error?.message || "千问 API 请求失败。");
    error.status = upstreamResponse.status;
    throw error;
  }

  return upstreamData?.choices?.[0]?.message?.content || "";
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

    const reply = await callQianwen([{ role: "system", content: buildSystemPrompt(body) }, ...messages]);
    response.writeHead(200, jsonHeaders);
    response.end(JSON.stringify({ reply: reply || "模型没有返回文本内容。" }));
  } catch (error) {
    response.writeHead(error.status || 500, jsonHeaders);
    response.end(JSON.stringify({ error: error.message || "服务器内部错误。" }));
  }
}

async function handleFormatResume(request, response) {
  try {
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 20000) : "";

    if (!text) {
      response.writeHead(400, jsonHeaders);
      response.end(JSON.stringify({ error: "缺少简历文本。" }));
      return;
    }

    const formattedText = await callQianwen(
      [
        {
          role: "system",
          content: [
            "你是简历文本排版整理助手，需要修复简历排版并对其进行分段",
            "用户会提供从 PDF 抽取出的混乱简历文本，大概率来自表格布局。",
            "请只做格式恢复、分段、标题识别和轻微标点修复，不要新增、删除或修改任何原本简历中的内容",
            "输出纯文本，不要 Markdown 表格，不要解释。",
            "分段目标是支持后续面试追问：每个段落应尽量对应一个可独立追问的简历点。",
            "粗粒度处理：基本信息、教育背景和课程、技能证书、荣誉称号等信息可合并成较少段落",
            "细粒度处理：科研实习经历、发表论文等重点考察内容可以按照不同项目、不同工作拆分为多个段落",
            "段落之间用一个空行分隔；段落标题单独成行。",
            "如果段落内部需要使用 - 列表，列表项仍属于该段落；不要在列表项之间插入空行。",
            "如果某些信息无法判断归类，就保留在最接近的段落中；宁可保守分段，不要编造缺失字段。",
          ].join("\n"),
        },
        { role: "user", content: text },
      ],
      { temperature: 0.2 },
    );

    response.writeHead(200, jsonHeaders);
    response.end(JSON.stringify({ formattedText: formattedText.trim() || text }));
  } catch (error) {
    response.writeHead(error.status || 500, jsonHeaders);
    response.end(JSON.stringify({ error: error.message || "简历整理失败。" }));
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

  if (request.method === "POST" && request.url === "/api/format-resume") {
    handleFormatResume(request, response);
    return;
  }

  response.writeHead(404, jsonHeaders);
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OfferForge API listening on http://127.0.0.1:${port}`);
});
