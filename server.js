import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const port = Number(process.env.PORT || 3001);
const apiKeyPath = process.env.QIANWEN_API_KEY_FILE || join(process.cwd(), "QianWen-API");
const doubaoApiKeyPath = process.env.DOUBAO_API_KEY_FILE || join(process.cwd(), "Doubao-API");
const basicQuestionPath = process.env.BASIC_QUESTION_FILE || join(process.cwd(), "basic_question");
const model = process.env.QIANWEN_MODEL || "qwen-plus";
const uploadDir = process.env.OFFERFORGE_UPLOAD_DIR || "/var/www/offerforge/uploads";
const defaultPublicBaseUrl = process.env.PUBLIC_BASE_URL || "";
const voiceDownloadBaseUrl = process.env.VOICE_DOWNLOAD_BASE_URL || "";
const maxJsonBytes = 16 * 1024 * 1024;
const doubaoSubmitEndpoint =
  process.env.DOUBAO_SUBMIT_ENDPOINT || "https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/submit";
const doubaoQueryEndpoint =
  process.env.DOUBAO_QUERY_ENDPOINT || "https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/query";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

async function readJson(request, limitBytes = 1024 * 1024) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > limitBytes) {
      const error = new Error("请求体过大。");
      error.status = 413;
      throw error;
    }
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

async function loadDoubaoCredentials() {
  const raw = await readFile(doubaoApiKeyPath, "utf8");
  const appId =
    raw.match(/API-App-Key[：:]\s*([0-9]+)/)?.[1]?.trim() ||
    raw.match(/appid\s*=\s*["']([^"']+)["']/)?.[1]?.trim();
  const accessKey = raw.match(/API-Access-Key[：:]\s*([^\s]+)/)?.[1]?.trim();
  const explicitApiKey =
    raw.match(/^API-KEY[：:]\s*([0-9a-f-]{36})/im)?.[1]?.trim() ||
    raw.match(/x-api-key:\s*([0-9a-f-]{36})/i)?.[1]?.trim();

  if (appId && accessKey && process.env.DOUBAO_AUTH_MODE !== "apikey") {
    return {
      mode: "legacy",
      appId,
      accessKey,
      resourceId: process.env.DOUBAO_RESOURCE_ID || "volc.bigasr.auc",
    };
  }

  if (explicitApiKey) {
    return {
      mode: "apikey",
      apiKey: explicitApiKey,
      resourceId: process.env.DOUBAO_RESOURCE_ID || "volc.seedasr.auc",
    };
  }

  if (appId && accessKey) {
    return {
      mode: "legacy",
      appId,
      accessKey,
      resourceId: process.env.DOUBAO_RESOURCE_ID || "volc.bigasr.auc",
    };
  }

  throw new Error("Doubao-API 文件中没有找到有效的 App-Key/Access-Key 或 API-Key。");
}

async function loadBasicQuestions() {
  const raw = await readFile(basicQuestionPath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function clampIndex(value, length) {
  if (!length) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(length - 1, Math.floor(numeric)));
}

function normalizeSections(resume) {
  return Array.isArray(resume?.sections)
    ? resume.sections.map((section) => String(section || "").trim()).filter(Boolean)
    : [];
}

const resumeQuestionAngles = [
  "基础掌握与理解",
  "具体实践细节",
  "为什么选择这一门课或这段经历",
  "遇到的难点与解决方式",
  "学到的结果与反思",
];

function pickResumeAngle() {
  return pickRandom(resumeQuestionAngles);
}

function buildSystemPrompt({ trainingMode, context, resume, followup }) {
  const followupCount = Number(followup?.count || 0);
  const maxFollowups = Number(followup?.maxCount || 4);
  const canFollowUp = followupCount < maxFollowups;
  const prompt = [
    "你是 OfferForge 的 AI 模拟面试官，目标用户是大三本科生，方向偏计算机/AI。",
    `训练模式：${trainingMode === "resume" ? "针对简历提问追问" : trainingMode === "project" ? "针对应聘项目个性化训练" : "通用类问题问答"}`,
    `基础用户信息：${context || "大三本科生，计算机/AI 方向。"}`,
    `当前连续追问次数：${followupCount}，追问上限：${maxFollowups}。`,
    canFollowUp
      ? "你需要判断：用户刚才的回答是否值得继续追问。如果值得，使用 follow_up；如果已经充分、偏离主题或需要覆盖新能力点，使用 new_question。"
      : "已经达到连续追问上限，本轮必须使用 new_question，另起一个新的问题方向。",
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
    "follow_up 的含义：围绕上一问题和用户刚才回答继续深挖，要求更具体的依据、细节、取舍、反思或量化结果。",
    "new_question 的含义：结束当前问题链，提出一个新的面试问题，可以覆盖新的能力点、简历点或项目维度。",
    "请用中文交流。每轮回复保持精炼，只提出一个问题；必要时附带一句很短的反馈。",
    "不要一次性给出长篇题库。",
    '你必须只输出 JSON，格式为：{"mode":"follow_up 或 new_question","reply":"要展示给用户的问题文本"}。不要输出 Markdown，不要输出额外解释。',
  );

  return prompt.join("\n");
}

function buildResumeScanPrompt({ candidate, context, trainingMode }) {
  return [
    "你是简历扫描助手。你的任务是判断当前简历条目是否值得面试官提问。",
    "你只能输出 JSON，格式为：{\"shouldAsk\":true或false,\"reply\":\"如果 shouldAsk 为 true，则给出一条简短的面试问题；如果为 false，则 reply 为空字符串\"}",
    "判断标准：如果这一段有信息量、职责、方法、结果、时间、角色、量化成果、技术选择、论文/实习/项目细节，就值得提问；如果只是基础信息、过短或重复，就跳过。",
    `当前基础用户信息：${context || "大三本科生，计算机/AI 方向。"}`,
    `当前模式：${trainingMode}`,
    `当前简历段落：${candidate}`,
    "如果值得提问，问题应自然聚焦在这一段，不要泛泛而谈。",
    "如果不值得提问，shouldAsk 设为 false，reply 留空。",
  ].join("\n");
}

function buildResumeQuestionPrompt({ section, context, angleHint }) {
  return [
    "你是简历面试官，正在针对这一段简历生成第一问。",
    "你必须只输出 JSON，格式为：{\"mode\":\"new_question\",\"reply\":\"要展示给用户的问题文本\"}",
    `提问角度：${angleHint}`,
    `基础用户信息：${context || "大三本科生，计算机/AI 方向。"}`,
    `当前简历段落：${section}`,
    "问题应自然聚焦在这一段，避免泛泛而谈。",
    "请用中文，保持简短，最多一句问题。",
  ].join("\n");
}

function buildResumeFollowupPrompt({ section, context, followup, angleHint }) {
  const followupCount = Number(followup?.count || 0);
  const maxFollowups = Number(followup?.maxCount || 4);

  return [
    "你是简历面试官，正在围绕同一条简历内容做追问。",
    "你必须只输出 JSON，格式为：{\"mode\":\"follow_up 或 new_question\",\"reply\":\"要展示给用户的问题文本\"}",
    "如果还有深挖空间，请使用 follow_up；如果这部分已经问得足够，或者应该转向下一段简历，请使用 new_question。",
    "follow_up 时，只围绕当前段继续追问，不要切换到别的简历段。",
    "new_question 时，只表示该段告一段落，不要在 reply 里解释为什么跳转。",
    `基础用户信息：${context || "大三本科生，计算机/AI 方向。"}`,
    `当前连续追问次数：${followupCount}，追问上限：${maxFollowups}。`,
    `当前追问角度：${angleHint}`,
    `当前简历段落：${section}`,
    "问题应尽量具体，围绕经历细节、技术选择、取舍、结果、反思或量化成果。",
    "请用中文，保持简短，最多一句问题。",
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

    const previousCount = Math.max(0, Number(body.followup?.count || 0));
    const maxCount = Math.max(1, Number(body.followup?.maxCount || 4));
    const forcedNewQuestion = previousCount >= maxCount;

    if (body.trainingMode === "general" && shouldUseBasicQuestion(body, messages, previousCount, forcedNewQuestion)) {
      const questions = await loadBasicQuestions();
      const reply = pickRandom(questions) || "请简单做一个自我介绍。";

      response.writeHead(200, jsonHeaders);
      response.end(JSON.stringify({ reply, followup: { mode: "new_question", count: 0, maxCount } }));
      return;
    }

    const rawReply = await callQianwen([{ role: "system", content: buildSystemPrompt(body) }, ...messages], {
      temperature: 0.45,
    });
    const parsedReply = parseInterviewReply(rawReply);
    let mode = !forcedNewQuestion && parsedReply.mode === "follow_up" ? "follow_up" : "new_question";
    let reply = parsedReply.reply || rawReply || "模型没有返回文本内容。";

    if (body.trainingMode === "general" && mode === "new_question") {
      const questions = await loadBasicQuestions();
      reply = pickRandom(questions) || reply;
    }

    const nextCount = mode === "follow_up" ? previousCount + 1 : 0;

    response.writeHead(200, jsonHeaders);
    response.end(
      JSON.stringify({
        reply,
        followup: { mode, count: nextCount, maxCount },
      }),
    );
  } catch (error) {
    response.writeHead(error.status || 500, jsonHeaders);
    response.end(JSON.stringify({ error: error.message || "服务器内部错误。" }));
  }
}

function shouldUseBasicQuestion(body, messages, previousCount, forcedNewQuestion) {
  if (forcedNewQuestion) {
    return true;
  }

  if (previousCount > 0) {
    return false;
  }

  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const lastUserText = userMessages.at(-1)?.content || "";
  const isStartRequest = /开始|出题|提问|新问题|下一个|来一题|面试/.test(lastUserText);

  return assistantMessages.length <= 1 || isStartRequest;
}

async function handleOpeningQuestion(request, response) {
  try {
    const body = await readJson(request);
    const trainingMode = body.trainingMode || "general";
    const questions = await loadBasicQuestions();
    let reply = "";

    if (trainingMode === "general") {
      reply = pickRandom(questions) || "请简单做一个自我介绍。";
    } else if (trainingMode === "resume") {
      reply = "请先上传简历，我会直接从简历内容开始追问。";
    } else if (trainingMode === "project") {
      reply = "请先介绍一个你最想被追问的项目：项目目标、你的角色、技术栈和结果。";
    } else {
      reply = pickRandom(questions) || "请简单做一个自我介绍。";
    }

    response.writeHead(200, jsonHeaders);
    response.end(JSON.stringify({ reply, followup: { mode: "new_question", count: 0, maxCount: 4 } }));
  } catch (error) {
    response.writeHead(error.status || 500, jsonHeaders);
    response.end(JSON.stringify({ error: error.message || "开场问题生成失败。" }));
  }
}

function parseInterviewReply(rawReply) {
  const fallback = { mode: "new_question", reply: rawReply };

  try {
    const jsonText = rawReply.match(/\{[\s\S]*\}/)?.[0] || rawReply;
    const parsed = JSON.parse(jsonText);
    const mode = parsed.mode === "follow_up" ? "follow_up" : "new_question";
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    return { mode, reply };
  } catch {
    return fallback;
  }
}

function parseResumeDecision(rawReply) {
  const fallback = { shouldAsk: true, reply: rawReply };

  try {
    const jsonText = rawReply.match(/\{[\s\S]*\}/)?.[0] || rawReply;
    const parsed = JSON.parse(jsonText);
    const shouldAsk = parsed.shouldAsk !== false;
    const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    return { shouldAsk, reply };
  } catch {
    return fallback;
  }
}

function getRequestOrigin(request) {
  if (defaultPublicBaseUrl) {
    return defaultPublicBaseUrl.replace(/\/$/, "");
  }

  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host;

  if (!host) {
    const error = new Error("无法确定公网访问地址，请通过 https://服务器IP 访问页面，或设置 PUBLIC_BASE_URL。");
    error.status = 500;
    throw error;
  }

  const normalizedHost = String(Array.isArray(host) ? host[0] : host).toLowerCase();
  return `${proto}://${normalizedHost}`.replace(/\/$/, "");
}

function getVoiceDownloadOrigin(request) {
  if (voiceDownloadBaseUrl) {
    return voiceDownloadBaseUrl.replace(/\/$/, "");
  }

  const origin = getRequestOrigin(request);
  return origin.replace(/^https:\/\//i, "http://");
}

function parseAudioPayload(body) {
  const mimeType = String(body.mimeType || "").toLowerCase();
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";

  if (!audioBase64) {
    const error = new Error("缺少录音数据。");
    error.status = 400;
    throw error;
  }

  const normalizedBase64 = audioBase64.replace(/^data:[^,]+,/, "");
  const buffer = Buffer.from(normalizedBase64, "base64");

  if (!buffer.length) {
    const error = new Error("录音数据为空。");
    error.status = 400;
    throw error;
  }

  if (buffer.length > 10 * 1024 * 1024) {
    const error = new Error("录音文件过大，请控制在 10MB 以内。");
    error.status = 413;
    throw error;
  }

  if (mimeType.includes("wav") || mimeType.includes("wave")) {
    return { buffer, extension: "wav", format: "wav", codec: "raw" };
  }

  if (mimeType.includes("ogg")) {
    return { buffer, extension: "ogg", format: "ogg", codec: "opus" };
  }

  const error = new Error("当前只支持 WAV 或 OGG 录音格式。");
  error.status = 400;
  throw error;
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTimeMs(value) {
  const numeric = safeNumber(value);
  if (numeric === null) {
    return 0;
  }

  return numeric > 100000 ? numeric / 1000 : numeric;
}

function collectAdditionsValue(additions, key) {
  if (!additions) {
    return null;
  }

  if (typeof additions === "string") {
    try {
      return collectAdditionsValue(JSON.parse(additions), key);
    } catch {
      return null;
    }
  }

  if (Array.isArray(additions)) {
    for (const item of additions) {
      const value = collectAdditionsValue(item, key);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  if (typeof additions === "object") {
    if (additions[key] !== undefined) {
      return safeNumber(additions[key]);
    }

    for (const value of Object.values(additions)) {
      const nestedValue = collectAdditionsValue(value, key);
      if (nestedValue !== null) {
        return nestedValue;
      }
    }
  }

  return null;
}

function extractDoubaoResult(data) {
  const rawResult = Array.isArray(data?.result) ? data.result[0] : data?.result || data;
  return {
    text: String(rawResult?.text || "").trim(),
    utterances: Array.isArray(rawResult?.utterances) ? rawResult.utterances : [],
    audioInfo: data?.audio_info || rawResult?.audio_info || data?.audioInfo || rawResult?.audioInfo || {},
    rawResult,
  };
}

function normalizeUtterances(result) {
  const utterances = Array.isArray(result?.utterances) ? result.utterances : [];

  return utterances
    .map((utterance) => ({
      text: String(utterance.text || "").trim(),
      startMs: normalizeTimeMs(utterance.start_time ?? utterance.startTime),
      endMs: normalizeTimeMs(utterance.end_time ?? utterance.endTime),
      speechRate: collectAdditionsValue(utterance.additions, "speech_rate"),
      volume: collectAdditionsValue(utterance.additions, "volume"),
    }))
    .filter((utterance) => utterance.text || utterance.endMs > utterance.startMs);
}

function average(numbers) {
  const values = numbers.filter((value) => Number.isFinite(value));
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildVoiceMetrics({ result, submittedDurationMs }) {
  const text = String(result?.text || "").trim();
  const utterances = normalizeUtterances(result);
  const resultDurationMs = safeNumber(result?.audioInfo?.duration);
  const durationSeconds = Math.max(
    0.1,
    (resultDurationMs ? normalizeTimeMs(resultDurationMs) : submittedDurationMs || 0) / 1000,
  );
  let longPauseCount = 0;
  let totalPauseMs = 0;

  for (let index = 1; index < utterances.length; index += 1) {
    const gapMs = utterances[index].startMs - utterances[index - 1].endMs;
    if (gapMs > 0) {
      totalPauseMs += gapMs;
    }
    if (gapMs >= 1200) {
      longPauseCount += 1;
    }
  }

  const textWithoutSpaces = text.replace(/\s/g, "");
  const charsPerMinute = Math.round((textWithoutSpaces.length / durationSeconds) * 60);
  const avgSpeechRate = average(utterances.map((utterance) => utterance.speechRate));
  const avgVolume = average(utterances.map((utterance) => utterance.volume));

  return {
    durationSeconds: Number(durationSeconds.toFixed(1)),
    charsPerMinute,
    utteranceCount: utterances.length,
    longPauseCount,
    totalPauseSeconds: Number((totalPauseMs / 1000).toFixed(1)),
    avgUtteranceSeconds: utterances.length
      ? Number(
          (
            utterances.reduce((sum, utterance) => sum + Math.max(0, utterance.endMs - utterance.startMs), 0) /
            utterances.length /
            1000
          ).toFixed(1),
        )
      : null,
    avgSpeechRate: avgSpeechRate === null ? null : Number(avgSpeechRate.toFixed(2)),
    avgVolume: avgVolume === null ? null : Number(avgVolume.toFixed(1)),
  };
}

function buildVoiceFeedbackPrompt({ text, metrics }) {
  return [
    "你是面试表达训练教练。请基于语音识别文本和客观指标，给用户中文反馈。",
    "目标用户是大三本科生，计算机/AI 方向，正在练习面试回答。",
    "只输出 JSON，格式为：{\"summary\":\"一句话总评\",\"suggestions\":[\"建议1\",\"建议2\",\"建议3\"]}",
    "反馈重点：语速、停顿、表达清晰度、回答结构。不要虚构音色、情绪或口音。",
    "如果转写文本很短，要提醒样本不足。",
    `转写文本：${text || "无有效转写文本"}`,
    `指标：${JSON.stringify(metrics)}`,
  ].join("\n");
}

function parseVoiceFeedback(rawReply, fallbackSummary) {
  try {
    const jsonText = rawReply.match(/\{[\s\S]*\}/)?.[0] || rawReply;
    const parsed = JSON.parse(jsonText);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : fallbackSummary,
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
        : [],
    };
  } catch {
    return { summary: fallbackSummary, suggestions: rawReply ? [rawReply.trim()] : [] };
  }
}

function buildRuleBasedVoiceFeedback(metrics, text) {
  const suggestions = [];

  if (metrics.charsPerMinute > 260) {
    suggestions.push("语速偏快，回答关键结论后可以主动停半拍，让面试官有时间消化。");
  } else if (metrics.charsPerMinute < 120) {
    suggestions.push("语速偏慢，建议先给结论，再补两三个关键依据，减少犹豫铺垫。");
  } else {
    suggestions.push("语速整体处在较容易理解的区间，可以继续保持。");
  }

  if (metrics.longPauseCount >= 2) {
    suggestions.push("长停顿较多，可以用“我分三点说”这类结构句争取组织时间。");
  }

  if (text.replace(/\s/g, "").length < 30) {
    suggestions.push("本次录音样本偏短，建议用 30 秒以上回答再做判断。");
  }

  return {
    summary: "已完成语音转写和表达指标分析。",
    suggestions: suggestions.slice(0, 3),
  };
}

function getDoubaoHeaders(response) {
  return {
    statusCode: response.headers.get("X-Api-Status-Code") || "",
    message: response.headers.get("X-Api-Message") || "",
    logId: response.headers.get("X-Tt-Logid") || "",
  };
}

function createDoubaoError(action, headers, data, fallbackStatus = 502) {
  const details = [
    headers.statusCode ? `状态码 ${headers.statusCode}` : "",
    headers.message ? `消息 ${headers.message}` : "",
    headers.logId ? `logid ${headers.logId}` : "",
  ]
    .filter(Boolean)
    .join("，");
  const bodyMessage = data?.message || data?.error || data?.error_msg || "";
  const error = new Error(`${action}失败${details ? `：${details}` : ""}${bodyMessage ? `，${bodyMessage}` : ""}`);
  error.status = fallbackStatus;
  error.doubao = headers;
  return error;
}

function buildDoubaoHeaders(credentials, requestId, extraHeaders = {}) {
  const authHeaders =
    credentials.mode === "legacy"
      ? {
          "X-Api-App-Key": credentials.appId,
          "X-Api-Access-Key": credentials.accessKey,
        }
      : {
          "X-Api-Key": credentials.apiKey,
        };

  return {
    ...authHeaders,
    "X-Api-Resource-Id": credentials.resourceId,
    "X-Api-Request-Id": requestId,
    ...extraHeaders,
  };
}

async function submitDoubaoTask({ credentials, requestId, audioUrl }) {
  const response = await fetch(doubaoSubmitEndpoint, {
    method: "POST",
    headers: buildDoubaoHeaders(credentials, requestId, {
      "Content-Type": "application/json",
      "X-Api-Sequence": "-1",
    }),
    body: JSON.stringify({
      user: { uid: "OfferForge" },
      audio: { url: audioUrl },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        enable_ddc: true,
        enable_speaker_info: true,
        enable_channel_split: false,
        show_utterances: true,
        vad_segment: false,
        sensitive_words_filter: "",
        corpus: {
          correct_table_name: "",
          context: "",
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  const headers = getDoubaoHeaders(response);

  if (!response.ok || (headers.statusCode && headers.statusCode !== "20000000")) {
    throw createDoubaoError("豆包语音任务提交", headers, data, response.status || 502);
  }

  return headers;
}

async function queryDoubaoTask({ credentials, requestId, submitLogId }) {
  let lastHeaders = {};
  let lastData = {};

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 900 : 1500));

    const response = await fetch(doubaoQueryEndpoint, {
      method: "POST",
      headers: buildDoubaoHeaders(credentials, requestId, {
        "Content-Type": "application/json",
        ...(submitLogId ? { "X-Tt-Logid": submitLogId } : {}),
      }),
      body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    const headers = getDoubaoHeaders(response);
    const statusCode = headers.statusCode;
    lastHeaders = headers;
    lastData = data;

    if (statusCode === "20000000") {
      return { data, headers };
    }

    if (statusCode === "20000001" || statusCode === "20000002") {
      continue;
    }

    if (statusCode === "20000003") {
      const error = new Error(
        `录音中没有检测到有效语音${headers.logId ? `（logid ${headers.logId}）` : ""}。`,
      );
      error.status = 422;
      error.doubao = headers;
      throw error;
    }

    if (!response.ok || statusCode || data?.message || data?.error) {
      throw createDoubaoError("豆包语音任务查询", headers, data, response.status || 502);
    }
  }

  const error = createDoubaoError(
    "豆包语音任务查询超时",
    lastHeaders,
    lastData,
    504,
  );
  error.message =
    `${error.message}。若本地回放有声音，通常是豆包任务处理较慢或公网音频 URL 暂时无法被访问。`;
  error.status = 504;
  throw error;
}

async function handleAnalyzeVoice(request, response) {
  try {
    const body = await readJson(request, maxJsonBytes);
    const { buffer, extension } = parseAudioPayload(body);
    const requestId = randomUUID();
    const filename = `${requestId}.${extension}`;
    const audioUrl = `${getVoiceDownloadOrigin(request)}/uploads/${filename}`;
    const submittedDurationMs = Math.max(0, Number(body.durationMs || 0));
    const credentials = await loadDoubaoCredentials();

    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, filename), buffer);
    console.log(
      `[voice] submit requestId=${requestId} resourceId=${credentials.resourceId} endpoint=${doubaoSubmitEndpoint} audioUrl=${audioUrl}`,
    );
    const submitHeaders = await submitDoubaoTask({ credentials, requestId, audioUrl });

    const { data: doubaoData, headers: queryHeaders } = await queryDoubaoTask({
      credentials,
      requestId,
      submitLogId: submitHeaders.logId,
    });
    const result = extractDoubaoResult(doubaoData);
    const text = result.text;
    const utterances = normalizeUtterances(result);
    const metrics = buildVoiceMetrics({ result, submittedDurationMs });
    const debug = {
      requestId,
      audioUrl,
      submit: submitHeaders,
      query: queryHeaders,
      resourceId: credentials.resourceId,
      endpoint: doubaoSubmitEndpoint,
    };

    if (!text) {
      const error = new Error("豆包已返回完成状态，但没有返回可识别文本。请检查音频内容、凭据授权和请求参数。");
      error.status = 422;
      error.debug = debug;
      throw error;
    }

    const fallbackFeedback = buildRuleBasedVoiceFeedback(metrics, text);
    let feedback = fallbackFeedback;

    try {
      const rawFeedback = await callQianwen(
        [{ role: "system", content: buildVoiceFeedbackPrompt({ text, metrics }) }],
        { temperature: 0.3 },
      );
      feedback = parseVoiceFeedback(rawFeedback, fallbackFeedback.summary);
      if (!feedback.suggestions.length) {
        feedback.suggestions = fallbackFeedback.suggestions;
      }
    } catch {
      feedback = fallbackFeedback;
    }

    response.writeHead(200, jsonHeaders);
    response.end(
      JSON.stringify({
        text,
        metrics,
        utterances: utterances.slice(0, 8),
        feedback,
        debug,
      }),
    );
  } catch (error) {
    response.writeHead(error.status || 500, jsonHeaders);
    response.end(JSON.stringify({ error: error.message || "语音分析失败。", debug: error.debug || error.doubao || null }));
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

async function handleResumeNextQuestion(request, response) {
  try {
    const body = await readJson(request);
    const trainingMode = body.trainingMode || "resume";
    const resume = body.resume || {};
    const followup = body.followup || {};
    const messages = validateMessages(body.messages);
    const previousCount = Math.max(0, Number(followup.count || 0));
    const maxCount = Math.max(1, Number(followup.maxCount || 4));
    const sections = normalizeSections(resume);
    const cursor = clampIndex(resume.cursor, sections.length) ?? 0;
    const activeIndex = clampIndex(resume.activeIndex, sections.length);
    const advanceToNext = Boolean(resume.advanceToNext);

    if (!sections.length) {
      response.writeHead(400, jsonHeaders);
      response.end(JSON.stringify({ error: "请先上传简历。" }));
      return;
    }

    const askableCandidates = [];
    if (activeIndex !== null && !advanceToNext && previousCount < maxCount && messages.length) {
      const currentSection = sections[activeIndex];
      const angleHint = pickResumeAngle();
      const rawFollowup = await callQianwen(
        [
          {
            role: "system",
            content: buildResumeFollowupPrompt({ section: currentSection, context: body.context, followup, angleHint }),
          },
          ...messages,
        ],
        { temperature: 0.45 },
      );
      const parsedFollowup = parseInterviewReply(rawFollowup);

      if (parsedFollowup.mode === "follow_up" && parsedFollowup.reply) {
        response.writeHead(200, jsonHeaders);
        response.end(
          JSON.stringify({
            reply: parsedFollowup.reply,
            followup: { mode: "follow_up", count: previousCount + 1, maxCount },
            resume: {
              cursor: Math.max(cursor, activeIndex + 1),
              activeIndex,
              activeSection: currentSection,
            },
          }),
        );
        return;
      }
    }

    const scanStart = activeIndex !== null ? Math.max(cursor, activeIndex + 1) : cursor;

    for (let index = scanStart; index < sections.length; index += 1) {
      const candidate = sections[index];
      const rawDecision = await callQianwen(
        [{ role: "system", content: buildResumeScanPrompt({ candidate, context: body.context, trainingMode }) }],
        { temperature: 0.2 },
      );
      const parsedDecision = parseResumeDecision(rawDecision);

      if (parsedDecision.shouldAsk) {
        askableCandidates.push({ index, candidate });
      }

      if (askableCandidates.length >= 4) {
        break;
      }
    }

    if (!askableCandidates.length) {
      response.writeHead(200, jsonHeaders);
      response.end(
        JSON.stringify({
          reply: "我已经浏览完这份简历，没有继续追问的点了。",
          followup: { mode: "new_question", count: 0, maxCount },
          resume: { cursor: sections.length, activeIndex: null },
        }),
      );
      return;
    }

    const chosenSection = pickRandom(askableCandidates);
    const angleHint = pickResumeAngle();
    const rawQuestion = await callQianwen(
      [
        {
          role: "system",
          content: buildResumeQuestionPrompt({
            section: chosenSection.candidate,
            context: body.context,
            angleHint,
          }),
        },
      ],
      { temperature: 0.55 },
    );
    const parsedQuestion = parseInterviewReply(rawQuestion);

    response.writeHead(200, jsonHeaders);
    response.end(
      JSON.stringify({
        reply: parsedQuestion.reply || "这一段经历能具体展开一下吗？",
        followup: { mode: "new_question", count: 0, maxCount },
        resume: { cursor: chosenSection.index + 1, activeIndex: chosenSection.index, activeSection: chosenSection.candidate },
      }),
    );
  } catch (error) {
    response.writeHead(error.status || 500, jsonHeaders);
    response.end(JSON.stringify({ error: error.message || "简历追问生成失败。" }));
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

  if (request.method === "POST" && request.url === "/api/resume-next-question") {
    handleResumeNextQuestion(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/opening-question") {
    handleOpeningQuestion(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/analyze-voice") {
    handleAnalyzeVoice(request, response);
    return;
  }

  response.writeHead(404, jsonHeaders);
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OfferForge API listening on http://127.0.0.1:${port}`);
});
