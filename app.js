import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const root = document.documentElement;
const themeToggle = document.querySelector("#themeToggle");
const themeIcon = document.querySelector("#themeIcon");
const clearButton = document.querySelector("#clearButton");
const trainingModeSelect = document.querySelector("#trainingModeSelect");
const prepSecondsInput = document.querySelector("#prepSecondsInput");
const resumeConfig = document.querySelector("#resumeConfig");
const resumeUpload = document.querySelector("#resumeUpload");
const confirmResumeUploadButton = document.querySelector("#confirmResumeUploadButton");
const resumeStatus = document.querySelector("#resumeStatus");
const clearResumeButton = document.querySelector("#clearResumeButton");
const resumePanel = document.querySelector("#resumePanel");
const resumeHint = document.querySelector("#resumeHint");
const resumeViewer = document.querySelector("#resumeViewer");
const followupState = document.querySelector("#followupState");
const followupLabel = document.querySelector("#followupLabel");
const followupCount = document.querySelector("#followupCount");
const stopFollowupButton = document.querySelector("#stopFollowupButton");
const connectionStatus = document.querySelector("#connectionStatus");
const timerPanel = document.querySelector("#timerPanel");
const timerPhase = document.querySelector("#timerPhase");
const timerValue = document.querySelector("#timerValue");
const hideTimerButton = document.querySelector("#hideTimerButton");
const showTimerButton = document.querySelector("#showTimerButton");
const messagesEl = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const composerTabs = Array.from(document.querySelectorAll("[data-composer-tab]"));
const composerPanels = Array.from(document.querySelectorAll("[data-composer-panel]"));
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const voicePanel = document.querySelector("#voicePanel");
const recordButton = document.querySelector("#recordButton");
const voiceStatus = document.querySelector("#voiceStatus");
const voicePlayback = document.querySelector("#voicePlayback");
const voiceFeedback = document.querySelector("#voiceFeedback");
const feedbackEmpty = document.querySelector("#feedbackEmpty");

const storageKey = "offerforge-chat-state";

let state = loadState();
let isSending = false;
let isFormattingResume = false;
let isAnalyzingVoice = false;
let activeComposerTab = "text";
let voicePlaybackUrl = "";
let voiceAnalyses = [];
let recorder = {
  context: null,
  source: null,
  processor: null,
  stream: null,
  chunks: [],
  sampleRate: 0,
  startedAt: 0,
  isRecording: false,
};
let resumeSectionsSignature = "";
let textTimer = {
  phase: "idle",
  startedAt: 0,
  elapsedMs: 0,
  intervalId: null,
};
let voiceTimer = {
  phase: "idle",
  startedAt: 0,
  elapsedMs: 0,
  intervalId: null,
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  const baseState = {
    dark: false,
    trainingMode: "general",
    prepSeconds: 5,
    timerVisible: true,
    followupCount: 0,
    followupMode: "new_question",
    resumeCursor: 0,
    resumeName: "",
    resumeText: "",
    resumeSections: [],
    activeResumeSection: null,
    messages: [],
  };

  if (!saved) {
    return baseState;
  }

  try {
    const parsed = JSON.parse(saved);
    const trainingMode = ["general", "resume"].includes(parsed.trainingMode) ? parsed.trainingMode : "general";
    return {
      ...baseState,
      ...parsed,
      trainingMode,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return baseState;
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function render() {
  root.classList.toggle("dark", state.dark);
  themeIcon.textContent = state.dark ? "☼" : "☾";
  trainingModeSelect.value = state.trainingMode;
  prepSecondsInput.value = state.prepSeconds;
  resumeConfig.hidden = state.trainingMode !== "resume";
  resumePanel.hidden = state.trainingMode !== "resume";
  resumeConfig.classList.toggle("is-loading", isFormattingResume);
  clearResumeButton.hidden = !state.resumeName;
  timerPanel.hidden = !state.timerVisible || activeComposerTab === "feedback";
  showTimerButton.hidden = state.timerVisible || activeComposerTab === "feedback";
  renderFollowupState();
  messagesEl.replaceChildren(...state.messages.map(createMessage));
  messagesEl.scrollTop = messagesEl.scrollHeight;
  renderResume();
  renderTimer();
  saveState();
}

function renderResume() {
  if (state.trainingMode !== "resume") {
    return;
  }

  if (!isFormattingResume) {
    resumeStatus.textContent = state.resumeName ? `已整理：${state.resumeName}` : "请选择文字版 PDF 简历。";
  }
  renderResumeHint();

  const signature = state.resumeSections.join("\u0000");
  if (signature !== resumeSectionsSignature) {
    resumeSectionsSignature = signature;
    if (!state.resumeSections.length) {
      resumeViewer.replaceChildren(createEmptyResume());
    } else {
      resumeViewer.replaceChildren(...state.resumeSections.map(createResumeSection));
    }
  }

  updateResumeHighlight();
  if (state.activeResumeSection !== null) {
    const activeNode = resumeViewer.querySelector(`.resume-section[data-index="${state.activeResumeSection}"]`);
    activeNode?.scrollIntoView({ block: "nearest" });
  }
}

function setResumeStatus(text, loading = false) {
  isFormattingResume = loading;
  resumeStatus.textContent = text;
  resumeConfig.classList.toggle("is-loading", loading);
}

function createEmptyResume() {
  const empty = document.createElement("div");
  empty.className = "resume-empty";
  empty.textContent = "暂无简历内容";
  return empty;
}

function createResumeSection(section, index) {
  const item = document.createElement("div");
  item.className = "resume-section";
  item.dataset.index = String(index);
  item.dataset.active = String(state.activeResumeSection === index);
  item.textContent = section;
  return item;
}

function updateResumeHighlight() {
  resumeViewer.querySelectorAll(".resume-section").forEach((sectionButton) => {
    sectionButton.dataset.active = String(
      Number(sectionButton.dataset.index) === state.activeResumeSection,
    );
  });
}

function renderResumeHint() {
  resumeHint.textContent =
    state.activeResumeSection !== null
      ? "Agent 正在围绕这段简历进行提问和追问。"
      : state.resumeSections.length
        ? "Agent 会从上到下扫描简历，只挑出有提问价值的部分。"
        : "选择“针对简历”后上传文字版 PDF。";
}

function createMessage(message) {
  const item = document.createElement("article");
  item.className = `message ${message.role === "user" ? "user" : "assistant"}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = message.role === "user" ? "你" : "AI 面试官";

  const content = document.createElement("p");
  content.textContent = message.content;

  item.append(label, content);
  return item;
}

function renderFollowupState() {
  const active = state.followupMode === "follow_up";
  followupState.dataset.active = String(active);
  followupLabel.textContent =
    state.trainingMode === "resume"
      ? active
        ? "简历追问"
        : "简历首问"
      : active
        ? "追问中"
        : "题库首问";
  followupCount.textContent = `${Math.min(state.followupCount, 4)} / 4`;
}

function setSending(nextValue) {
  isSending = nextValue;
  sendButton.disabled = nextValue;
  messageInput.disabled = nextValue;
  recordButton.disabled = nextValue || isAnalyzingVoice;
  connectionStatus.classList.remove("is-busy");
  connectionStatus.textContent = nextValue ? "AI 正在生成回复..." : "已连接本地代理，可以继续对话。";
}

function setVoiceStatus(text, busy = false) {
  isAnalyzingVoice = busy;
  voiceStatus.textContent = text;
  recordButton.disabled = busy || isSending;
  recordButton.classList.toggle("is-recording", recorder.isRecording);
  recordButton.textContent = recorder.isRecording ? "停止并分析" : "开始录音";
  voicePanel.classList.toggle("is-busy", busy);
}

function setComposerTab(tabName) {
  activeComposerTab = tabName;
  composerTabs.forEach((tab) => {
    const active = tab.dataset.composerTab === tabName;
    tab.setAttribute("aria-selected", String(active));
  });
  composerPanels.forEach((panel) => {
    panel.hidden = panel.dataset.composerPanel !== tabName;
  });

  if (tabName === "text") {
    messageInput.focus();
  }
  renderTimer();
}

function formatMilliseconds(totalMs) {
  const safeMs = Math.max(0, Math.floor(totalMs));
  const minutes = String(Math.floor(safeMs / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((safeMs % 60000) / 1000)).padStart(2, "0");
  const milliseconds = String(safeMs % 1000).padStart(3, "0");
  return `${minutes}:${seconds}.${milliseconds}`;
}

function currentTimerMs() {
  const activeTimer = activeComposerTab === "voice" ? voiceTimer : textTimer;

  if (activeTimer.phase === "answering" || activeTimer.phase === "recording") {
    return performance.now() - activeTimer.startedAt;
  }

  return activeTimer.elapsedMs || 0;
}

function renderTimer() {
  const labels = {
    idle: "等待问题",
    answering: "文本作答",
    recording: "语音录制",
    finished: "本次录音",
  };
  const activeTimer = activeComposerTab === "voice" ? voiceTimer : textTimer;

  if (activeComposerTab === "feedback") {
    timerPanel.hidden = true;
    showTimerButton.hidden = true;
    return;
  }

  timerPanel.hidden = !state.timerVisible;
  showTimerButton.hidden = state.timerVisible;
  timerPhase.textContent = labels[activeTimer.phase] || "等待问题";
  timerValue.textContent = formatMilliseconds(currentTimerMs());
  timerPanel.dataset.phase = activeTimer.phase;
}

function stopSpecificTimer(timerState, nextPhase = "idle") {
  if (timerState.intervalId) {
    clearInterval(timerState.intervalId);
  }

  const elapsedMs =
    timerState.phase === "answering" || timerState.phase === "recording"
      ? performance.now() - timerState.startedAt
      : timerState.elapsedMs || 0;

  return {
    phase: nextPhase,
    startedAt: 0,
    elapsedMs: nextPhase === "idle" ? 0 : elapsedMs,
    intervalId: null,
  };
}

function stopTextTimer(nextPhase = "idle") {
  textTimer = stopSpecificTimer(textTimer, nextPhase);
  renderTimer();
}

function stopVoiceTimer(nextPhase = "idle") {
  voiceTimer = stopSpecificTimer(voiceTimer, nextPhase);
  renderTimer();
}

function startTimer(timerName) {
  if (timerName === "voice") {
    textTimer = stopSpecificTimer(textTimer, "idle");
    voiceTimer = stopSpecificTimer(voiceTimer, "idle");
    voiceTimer = {
      phase: "recording",
      startedAt: performance.now(),
      elapsedMs: 0,
      intervalId: window.setInterval(renderTimer, 33),
    };
    renderTimer();
    return;
  }

  textTimer = stopSpecificTimer(textTimer, "idle");
  voiceTimer = stopSpecificTimer(voiceTimer, "idle");
  textTimer = {
    phase: "answering",
    startedAt: performance.now(),
    elapsedMs: 0,
    intervalId: window.setInterval(renderTimer, 33),
  };
  renderTimer();
}

function buildPayload() {
  return {
    trainingMode: state.trainingMode,
    context: "大三本科生，计算机/AI 方向。",
    followup: {
      mode: state.followupMode,
      count: state.followupCount,
      maxCount: 4,
    },
    resume: {
      name: state.resumeName,
      text: state.resumeText.slice(0, 12000),
      sections: state.resumeSections,
      cursor: state.resumeCursor,
      activeIndex: state.activeResumeSection,
      advanceToNext: false,
      activeSection:
        typeof state.activeResumeSection === "number" ? state.resumeSections[state.activeResumeSection] : "",
    },
    messages: state.messages.filter((message) => ["user", "assistant"].includes(message.role)).slice(-12),
  };
}

function applyResumeResponse(data) {
  if (!data?.resume) {
    return;
  }

  state.resumeCursor = Math.max(0, Number(data.resume.cursor ?? state.resumeCursor));
  state.activeResumeSection =
    data.resume.activeIndex === null || data.resume.activeIndex === undefined
      ? null
      : Number(data.resume.activeIndex);
}

async function sendMessage(text) {
  stopTextTimer("idle");
  state.messages.push({ role: "user", content: text });
  render();
  setSending(true);

  try {
    const endpoint = state.trainingMode === "resume" ? "/api/resume-next-question" : "/api/chat";
    const payload = buildPayload();
    if (state.trainingMode === "resume") {
      payload.resume.advanceToNext = false;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "模型服务暂时不可用。");
    }

    state.messages.push({ role: "assistant", content: data.reply || "我没有收到有效回复，请再试一次。" });
    state.followupMode = data.followup?.mode === "follow_up" ? "follow_up" : "new_question";
    state.followupCount = Math.max(0, Math.min(4, Number(data.followup?.count ?? 0)));
    applyResumeResponse(data);
    if (state.trainingMode === "resume" && state.activeResumeSection === null) {
      stopTextTimer("idle");
    } else {
      startTimer("text");
    }
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `请求失败：${error.message}`,
    });
    stopTextTimer("idle");
  } finally {
    setSending(false);
    render();
    messageInput.focus();
  }
}

themeToggle.addEventListener("click", () => {
  state.dark = !state.dark;
  render();
});

function resetConversation() {
  state.messages = [];
  state.followupMode = "new_question";
  state.followupCount = 0;
  state.resumeCursor = 0;
  state.activeResumeSection = null;
  voiceAnalyses = [];
  voiceFeedback.replaceChildren();
  voiceFeedback.hidden = true;
  feedbackEmpty.hidden = false;
  stopTextTimer("idle");
  stopVoiceTimer("idle");
}

clearButton.addEventListener("click", () => {
  resetConversation();
  render();
  requestOpeningQuestion();
});

trainingModeSelect.addEventListener("change", () => {
  state.trainingMode = trainingModeSelect.value;
  resetConversation();
  render();
  if (state.trainingMode === "resume") {
    if (state.resumeSections.length) {
      requestResumeQuestion();
    }
  } else {
    requestOpeningQuestion();
  }
});

prepSecondsInput.addEventListener("input", () => {
  const nextValue = Math.max(0, Math.min(60, Number(prepSecondsInput.value) || 0));
  state.prepSeconds = nextValue;
  saveState();
});

resumeUpload.addEventListener("change", () => {
  const file = resumeUpload.files?.[0];
  setResumeStatus(file ? `已选择：${file.name}。点击“确认上传”解析。` : "请选择文字版 PDF 简历。");
});

confirmResumeUploadButton.addEventListener("click", async () => {
  const file = resumeUpload.files?.[0];

  if (!file) {
    setResumeStatus("请先选择一个 PDF 文件。");
    return;
  }

  confirmResumeUploadButton.disabled = true;
  resumeUpload.disabled = true;
  setResumeStatus("正在解析 PDF...", true);

  try {
    const extractedText = await extractPdfText(file);
    setResumeStatus("正在整理简历格式...", true);
    const formattedText = await formatResumeWithAgent(extractedText);
    const sections = splitResumeText(formattedText);

    if (!sections.length) {
      throw new Error("没有读取到可用文字。请确认 PDF 不是纯扫描图片。");
    }

    state.resumeName = file.name;
    state.resumeText = formattedText;
    state.resumeSections = sections;
    state.resumeCursor = 0;
    state.activeResumeSection = null;
    state.followupMode = "new_question";
    state.followupCount = 0;
    state.messages = [];
    isFormattingResume = false;
    render();
    requestResumeQuestion();
  } catch (error) {
    setResumeStatus(`解析失败：${error.message}`);
  } finally {
    confirmResumeUploadButton.disabled = false;
    resumeUpload.disabled = false;
    resumeUpload.value = "";
    resumeConfig.classList.toggle("is-loading", false);
  }
});

clearResumeButton.addEventListener("click", () => {
  resetConversation();
  state.resumeName = "";
  state.resumeText = "";
  state.resumeSections = [];
  state.activeResumeSection = null;
  resumeUpload.value = "";
  setResumeStatus("请选择文字版 PDF 简历。");
  resumeViewer.replaceChildren(createEmptyResume());
  render();
});

stopFollowupButton.addEventListener("click", () => {
  state.followupMode = "new_question";
  state.followupCount = 0;
  render();
  if (state.trainingMode === "resume") {
    requestResumeQuestion({ append: true, advanceToNext: true });
    return;
  }

  requestOpeningQuestion({ append: true, force: true });
});

async function extractPdfText(file) {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = buildPageText(content.items);
    pageTexts.push(pageText);
  }

  return pageTexts.join("\n\n").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

function buildPageText(items) {
  const rows = [];
  const sortedItems = items
    .filter((item) => item.str?.trim())
    .map((item) => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5],
    }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  for (const item of sortedItems) {
    const row = rows.find((entry) => Math.abs(entry.y - item.y) < 4);

    if (row) {
      row.items.push(item);
      row.y = (row.y + item.y) / 2;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows
    .map((row) =>
      row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" "),
    )
    .join("\n");
}

async function formatResumeWithAgent(text) {
  const response = await fetch("/api/format-resume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "简历整理失败。");
  }

  return data.formattedText || text;
}

function splitResumeText(text) {
  const normalized = text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const blocks = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const mergedBlocks = [];

  for (const block of blocks) {
    if (/^[-*•]\s+/.test(block) && mergedBlocks.length) {
      mergedBlocks[mergedBlocks.length - 1] = `${mergedBlocks[mergedBlocks.length - 1]}\n${block}`;
    } else {
      mergedBlocks.push(block);
    }
  }

  if (mergedBlocks.length > 1) {
    return mergedBlocks.map((item) => item.slice(0, 1200));
  }

  return normalized
    .split(/(?<=。)|(?<=；)|(?<=：)|\s{4,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.slice(0, 900));
}

function flattenAudioChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
  if (outputSampleRate === inputSampleRate) {
    return buffer;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  for (let index = 0; index < newLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(Math.floor((index + 1) * ratio), buffer.length);
    let sum = 0;
    let count = 0;

    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      sum += buffer[sourceIndex];
      count += 1;
    }

    result[index] = count ? sum / count : 0;
  }

  return result;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const sample of samples) {
    const clampedSample = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("loadend", () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    });
    reader.addEventListener("error", () => reject(new Error("录音读取失败。")));
    reader.readAsDataURL(blob);
  });
}

function calculatePeakLevel(samples) {
  let peak = 0;

  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }

  return peak;
}

function renderVoicePlayback(blob, { durationMs, peakLevel }) {
  if (voicePlaybackUrl) {
    URL.revokeObjectURL(voicePlaybackUrl);
  }

  voicePlaybackUrl = URL.createObjectURL(blob);

  const label = document.createElement("p");
  label.className = "voice-playback-label";
  label.textContent = "本地录音回放";

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = voicePlaybackUrl;

  const detail = document.createElement("p");
  detail.className = "voice-playback-detail";
  detail.textContent = `时长 ${(durationMs / 1000).toFixed(1)}s · 本地音量 ${Math.round(peakLevel * 100)}%`;

  const hint = document.createElement("p");
  hint.className = "voice-playback-hint";
  hint.textContent = peakLevel < 0.02 ? "声音偏小，建议检查麦克风输入。" : "可回放检查自己的语速、停顿和清晰度。";

  voicePlayback.replaceChildren(label, audio, detail, hint);
  voicePlayback.hidden = false;
}

function formatVoiceMetrics(metrics) {
  const parts = [
    `时长 ${metrics.durationSeconds}s`,
    `语速 ${metrics.charsPerMinute} 字/分钟`,
    `长停顿 ${metrics.longPauseCount} 次`,
  ];

  if (metrics.avgSpeechRate !== null && metrics.avgSpeechRate !== undefined) {
    parts.push(`token 语速 ${metrics.avgSpeechRate}/s`);
  }

  if (metrics.avgVolume !== null && metrics.avgVolume !== undefined) {
    parts.push(`音量 ${metrics.avgVolume} dB`);
  }

  return parts.join(" · ");
}

function averageVoiceMetric(key) {
  const values = voiceAnalyses
    .map((analysis) => Number(analysis.metrics?.[key]))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateVoiceScore() {
  if (!voiceAnalyses.length) {
    return 0;
  }

  const avgCharsPerMinute = averageVoiceMetric("charsPerMinute") || 0;
  const avgLongPause = averageVoiceMetric("longPauseCount") || 0;
  const avgDuration = averageVoiceMetric("durationSeconds") || 0;
  let score = 82;

  if (avgDuration < 20) {
    score -= 12;
  }

  if (avgCharsPerMinute < 120) {
    score -= 10;
  } else if (avgCharsPerMinute > 260) {
    score -= 8;
  }

  if (avgLongPause >= 2) {
    score -= 8;
  }

  return Math.max(45, Math.min(95, Math.round(score)));
}

function buildOverallVoiceSuggestions({ avgCharsPerMinute, avgLongPause, avgDuration }) {
  const suggestions = [];

  if (avgDuration !== null && avgDuration < 20) {
    suggestions.push("目前样本偏短，建议用 30 秒以上的完整回答做判断。");
  }

  if (avgCharsPerMinute !== null && avgCharsPerMinute > 260) {
    suggestions.push("整体语速偏快，关键结论后可以停半拍。");
  } else if (avgCharsPerMinute !== null && avgCharsPerMinute < 120) {
    suggestions.push("整体语速偏慢，建议减少铺垫，先给结论再补依据。");
  } else if (avgCharsPerMinute !== null) {
    suggestions.push("整体语速处在较容易理解的区间。");
  }

  if (avgLongPause !== null && avgLongPause >= 2) {
    suggestions.push("长停顿偏多，可以用分点表达降低临场组织压力。");
  }

  if (!suggestions.length) {
    suggestions.push("继续积累更多语音回答后，评价会更稳定。");
  }

  return suggestions;
}

function renderVoiceFeedback() {
  if (!voiceAnalyses.length) {
    voiceFeedback.hidden = true;
    feedbackEmpty.hidden = false;
    return;
  }

  const avgCharsPerMinute = averageVoiceMetric("charsPerMinute");
  const avgLongPause = averageVoiceMetric("longPauseCount");
  const avgDuration = averageVoiceMetric("durationSeconds");
  const latest = voiceAnalyses.at(-1);
  const score = calculateVoiceScore();

  const summary = document.createElement("p");
  summary.className = "voice-summary";
  summary.textContent = `语言表达总体评分：${score} / 100`;

  const metrics = document.createElement("p");
  metrics.className = "voice-metrics";
  metrics.textContent = [
    `已记录 ${voiceAnalyses.length} 次`,
    avgDuration === null ? "" : `平均时长 ${avgDuration.toFixed(1)}s`,
    avgCharsPerMinute === null ? "" : `平均语速 ${Math.round(avgCharsPerMinute)} 字/分钟`,
    avgLongPause === null ? "" : `平均长停顿 ${avgLongPause.toFixed(1)} 次`,
  ]
    .filter(Boolean)
    .join(" · ");

  const list = document.createElement("ul");
  for (const suggestion of buildOverallVoiceSuggestions({ avgCharsPerMinute, avgLongPause, avgDuration })) {
    const item = document.createElement("li");
    item.textContent = suggestion;
    list.append(item);
  }

  const latestNote = document.createElement("p");
  latestNote.className = "voice-latest";
  latestNote.textContent = `最近一次：${formatVoiceMetrics(latest.metrics || {})}`;

  voiceFeedback.replaceChildren(summary, metrics, list, latestNote);
  voiceFeedback.hidden = false;
  feedbackEmpty.hidden = true;
}

async function startRecording() {
  if (!window.isSecureContext) {
    setVoiceStatus("浏览器禁止非 HTTPS 页面录音。请使用 HTTPS 域名访问，或在本机 localhost 调试。");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setVoiceStatus("当前浏览器没有开放麦克风接口，请换用最新版 Chrome、Edge 或 Safari。");
    return;
  }

  const BrowserAudioContext = window.AudioContext || window.webkitAudioContext;
  if (!BrowserAudioContext) {
    setVoiceStatus("当前浏览器不支持 Web Audio 录音，请换用最新版 Chrome、Edge 或 Safari。");
    return;
  }

  voicePlayback.hidden = true;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const context = new BrowserAudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);

  recorder = {
    context,
    source,
    processor,
    stream,
    chunks: [],
    sampleRate: context.sampleRate,
    startedAt: performance.now(),
    isRecording: true,
  };

  processor.onaudioprocess = (event) => {
    if (!recorder.isRecording) {
      return;
    }

    recorder.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(processor);
  processor.connect(context.destination);
  startTimer("voice");
  setVoiceStatus("正在录音，回答结束后点击停止并分析。");
}

function cleanupRecorder() {
  recorder.processor?.disconnect();
  recorder.source?.disconnect();
  recorder.stream?.getTracks().forEach((track) => track.stop());
  recorder.context?.close();
}

async function stopRecordingAndAnalyze() {
  const durationMs = Math.max(0, performance.now() - recorder.startedAt);
  recorder.isRecording = false;
  stopVoiceTimer("finished");
  setVoiceStatus("正在整理录音并提交分析...", true);
  cleanupRecorder();

  const rawSamples = flattenAudioChunks(recorder.chunks);
  recorder.chunks = [];

  if (durationMs < 800 || rawSamples.length < 8000) {
    setVoiceStatus("录音太短，请至少回答 1 秒以上。");
    return;
  }

  const targetSampleRate = 16000;
  const samples = downsampleBuffer(rawSamples, recorder.sampleRate, targetSampleRate);
  const wavBlob = encodeWav(samples, targetSampleRate);
  renderVoicePlayback(wavBlob, { durationMs, peakLevel: calculatePeakLevel(samples) });
  const audioBase64 = await blobToBase64(wavBlob);

  setVoiceStatus("正在识别语音并生成表达反馈...", true);
  const response = await fetch("/api/analyze-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64,
      mimeType: wavBlob.type,
      durationMs,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const debugParts = [
      data.debug?.statusCode ? `状态码 ${data.debug.statusCode}` : "",
      data.debug?.message ? `消息 ${data.debug.message}` : "",
      data.debug?.logId ? `logid ${data.debug.logId}` : "",
    ].filter(Boolean);
    throw new Error(`${data.error || "语音分析失败。"}${debugParts.length ? `（${debugParts.join("，")}）` : ""}`);
  }

  if (data.text) {
    messageInput.value = data.text;
  }

  voiceAnalyses.push({ metrics: data.metrics || {}, feedback: data.feedback || {}, text: data.text || "" });
  renderVoiceFeedback();
  setVoiceStatus(data.text ? "已转写到文本回答，可修改后发送。" : "已完成分析，但没有识别到文本。");
}

hideTimerButton.addEventListener("click", () => {
  state.timerVisible = false;
  render();
});

showTimerButton.addEventListener("click", () => {
  state.timerVisible = true;
  render();
});

composerTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setComposerTab(tab.dataset.composerTab);
  });
});

recordButton.addEventListener("click", async () => {
  if (isAnalyzingVoice || isSending) {
    return;
  }

  try {
    if (recorder.isRecording) {
      await stopRecordingAndAnalyze();
    } else {
      await startRecording();
    }
  } catch (error) {
    recorder.isRecording = false;
    stopVoiceTimer("idle");
    cleanupRecorder();
    setVoiceStatus(`语音失败：${error.message}`);
  }
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (isSending) {
    return;
  }

  const text = messageInput.value.trim();

  if (!text) {
    return;
  }

  messageInput.value = "";
  sendMessage(text);
});

async function requestOpeningQuestion({ append = false, force = false } = {}) {
  if (state.trainingMode === "resume") {
    if (!state.resumeSections.length) {
      connectionStatus.textContent = "请先上传简历后开始第一题。";
      render();
      return;
    }

    await requestResumeQuestion({ append, force });
    return;
  }

  if (state.messages.length && !force && !append) {
    render();
    return;
  }

  stopTextTimer("idle");
  setSending(true);
  connectionStatus.textContent = "正在生成开场问题...";

  try {
    const response = await fetch("/api/opening-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trainingMode: state.trainingMode }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "开场问题生成失败。");
    }

    const openingMessage = { role: "assistant", content: data.reply || "请简单做一个自我介绍。" };
    state.messages = append && state.messages.length ? [...state.messages, openingMessage] : [openingMessage];
    state.followupMode = data.followup?.mode === "follow_up" ? "follow_up" : "new_question";
    state.followupCount = Math.max(0, Math.min(4, Number(data.followup?.count ?? 0)));
    startTimer("text");
  } catch {
    const openingMessage = { role: "assistant", content: "请简单做一个自我介绍。" };
    state.messages = append && state.messages.length ? [...state.messages, openingMessage] : [openingMessage];
    startTimer("text");
  } finally {
    setSending(false);
    render();
  }
}

async function requestResumeQuestion({ append = false, advanceToNext = false } = {}) {
  if (!state.resumeSections.length) {
    connectionStatus.textContent = "请先上传简历后开始第一题。";
    render();
    return;
  }

  stopTextTimer("idle");
  setSending(true);
  connectionStatus.textContent = "正在扫描简历并生成问题...";
  connectionStatus.classList.add("is-busy");

  try {
    const payload = buildPayload();
    payload.resume.advanceToNext = advanceToNext;

    const response = await fetch("/api/resume-next-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "简历问题生成失败。");
    }

    const assistantMessage = { role: "assistant", content: data.reply || "这一段经历能具体展开一下吗？" };
    state.messages = append && state.messages.length ? [...state.messages, assistantMessage] : [assistantMessage];
    state.followupMode = data.followup?.mode === "follow_up" ? "follow_up" : "new_question";
    state.followupCount = Math.max(0, Math.min(4, Number(data.followup?.count ?? 0)));
    applyResumeResponse(data);

    if (state.activeResumeSection !== null) {
      startTimer("text");
    } else {
      stopTextTimer("idle");
    }
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `请求失败：${error.message}`,
    });
    stopTextTimer("idle");
  } finally {
    setSending(false);
    render();
    messageInput.focus();
  }
}

render();
setComposerTab(activeComposerTab);
if (state.trainingMode === "resume") {
  if (state.resumeSections.length && !state.messages.length) {
    requestResumeQuestion();
  }
} else {
  requestOpeningQuestion();
}
