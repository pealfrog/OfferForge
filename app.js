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
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");

const storageKey = "offerforge-chat-state";

let state = loadState();
let isSending = false;
let isFormattingResume = false;
let resumeSectionsSignature = "";
let timer = {
  phase: "idle",
  durationMs: 0,
  startedAt: 0,
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
    return {
      ...baseState,
      ...parsed,
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
  timerPanel.hidden = !state.timerVisible;
  showTimerButton.hidden = state.timerVisible;
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
  connectionStatus.textContent = nextValue ? "AI 正在生成回复..." : "已连接本地代理，可以继续对话。";
}

function formatMilliseconds(totalMs) {
  const safeMs = Math.max(0, Math.floor(totalMs));
  const minutes = String(Math.floor(safeMs / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((safeMs % 60000) / 1000)).padStart(2, "0");
  const milliseconds = String(safeMs % 1000).padStart(3, "0");
  return `${minutes}:${seconds}.${milliseconds}`;
}

function currentTimerMs() {
  if (timer.phase === "preparing") {
    return timer.durationMs - (performance.now() - timer.startedAt);
  }

  if (timer.phase === "answering") {
    return performance.now() - timer.startedAt;
  }

  return 0;
}

function renderTimer() {
  const labels = {
    idle: "等待问题",
    preparing: "准备中",
    answering: "正式作答",
  };

  timerPhase.textContent = labels[timer.phase];
  timerValue.textContent = formatMilliseconds(currentTimerMs());
  timerPanel.dataset.phase = timer.phase;
}

function stopTimer(nextPhase = "idle") {
  if (timer.intervalId) {
    clearInterval(timer.intervalId);
  }

  timer = {
    phase: nextPhase,
    durationMs: 0,
    startedAt: 0,
    intervalId: null,
  };
  renderTimer();
}

function startAnswerTimer() {
  if (timer.intervalId) {
    clearInterval(timer.intervalId);
  }

  timer = {
    phase: "answering",
    durationMs: 0,
    startedAt: performance.now(),
    intervalId: window.setInterval(() => {
      renderTimer();
    }, 33),
  };
  renderTimer();
}

function startPrepTimer() {
  const prepSeconds = Math.max(0, Math.min(60, Number(state.prepSeconds) || 0));

  if (prepSeconds === 0) {
    startAnswerTimer();
    return;
  }

  if (timer.intervalId) {
    clearInterval(timer.intervalId);
  }

  timer = {
    phase: "preparing",
    durationMs: prepSeconds * 1000,
    startedAt: performance.now(),
    intervalId: window.setInterval(() => {
      if (currentTimerMs() <= 0) {
        startAnswerTimer();
        return;
      }

      renderTimer();
    }, 33),
  };
  renderTimer();
}

function buildPayload() {
  return {
    trainingMode: state.trainingMode,
    context:
      state.trainingMode === "project"
        ? "大三本科生，计算机/AI 方向，正在准备应聘项目训练。"
        : "大三本科生，计算机/AI 方向。",
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
  stopTimer();
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
      stopTimer();
    } else {
      startPrepTimer();
    }
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `请求失败：${error.message}`,
    });
    stopTimer();
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
  stopTimer();
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

hideTimerButton.addEventListener("click", () => {
  state.timerVisible = false;
  render();
});

showTimerButton.addEventListener("click", () => {
  state.timerVisible = true;
  render();
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

  stopTimer();
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
    startPrepTimer();
  } catch {
    const openingMessage = { role: "assistant", content: "请简单做一个自我介绍。" };
    state.messages = append && state.messages.length ? [...state.messages, openingMessage] : [openingMessage];
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

  stopTimer();
  setSending(true);
  connectionStatus.textContent = "正在扫描简历并生成问题...";

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
      startPrepTimer();
    } else {
      stopTimer();
    }
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `请求失败：${error.message}`,
    });
    stopTimer();
  } finally {
    setSending(false);
    render();
    messageInput.focus();
  }
}

render();
if (state.trainingMode === "resume") {
  if (state.resumeSections.length && !state.messages.length) {
    requestResumeQuestion();
  }
} else {
  requestOpeningQuestion();
}
