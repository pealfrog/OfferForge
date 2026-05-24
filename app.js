import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

const root = document.documentElement;
const themeToggle = document.querySelector("#themeToggle");
const themeIcon = document.querySelector("#themeIcon");
const clearButton = document.querySelector("#clearButton");
const trainingModeSelect = document.querySelector("#trainingModeSelect");
const scenarioSelect = document.querySelector("#scenarioSelect");
const roleInput = document.querySelector("#roleInput");
const profileInput = document.querySelector("#profileInput");
const prepSecondsInput = document.querySelector("#prepSecondsInput");
const resumeConfig = document.querySelector("#resumeConfig");
const resumeUpload = document.querySelector("#resumeUpload");
const confirmResumeUploadButton = document.querySelector("#confirmResumeUploadButton");
const resumeStatus = document.querySelector("#resumeStatus");
const clearResumeButton = document.querySelector("#clearResumeButton");
const resumePanel = document.querySelector("#resumePanel");
const resumeHint = document.querySelector("#resumeHint");
const resumeViewer = document.querySelector("#resumeViewer");
const clearHighlightButton = document.querySelector("#clearHighlightButton");
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
const welcomeMessage = {
  role: "assistant",
  content:
    "你好，我是 OfferForge 的模拟面试官。你可以先告诉我目标岗位、保研方向或简历亮点；也可以直接说“开始面试”。",
};

let state = loadState();
let isSending = false;
let isFormattingResume = false;
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
    scenario: "保研面试",
    role: "计算机专业大三学生",
    profile: "",
    prepSeconds: 5,
    timerVisible: true,
    resumeName: "",
    resumeText: "",
    resumeSections: [],
    activeResumeSection: null,
    messages: [welcomeMessage],
  };

  if (!saved) {
    return baseState;
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      ...baseState,
      ...parsed,
      messages: Array.isArray(parsed.messages) && parsed.messages.length ? parsed.messages : [welcomeMessage],
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
  scenarioSelect.value = state.scenario;
  roleInput.value = state.role;
  profileInput.value = state.profile;
  prepSecondsInput.value = state.prepSeconds;
  resumeConfig.hidden = state.trainingMode !== "resume";
  resumePanel.hidden = state.trainingMode !== "resume";
  resumeConfig.classList.toggle("is-loading", isFormattingResume);
  clearResumeButton.hidden = !state.resumeName;
  timerPanel.hidden = !state.timerVisible;
  showTimerButton.hidden = state.timerVisible;
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

  resumeStatus.textContent = state.resumeName ? `已整理：${state.resumeName}` : "请选择文字版 PDF 简历。";
  resumeHint.textContent = state.activeResumeSection
    ? "当前高亮片段会随下一轮对话发送给面试官。"
    : "点击一段简历内容，标记面试官正在追问的部分。";

  if (!state.resumeSections.length) {
    resumeViewer.replaceChildren(createEmptyResume());
    return;
  }

  resumeViewer.replaceChildren(...state.resumeSections.map(createResumeSection));
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
  const button = document.createElement("button");
  button.className = "resume-section";
  button.type = "button";
  button.dataset.active = String(state.activeResumeSection === index);
  button.textContent = section;
  button.addEventListener("click", () => {
    state.activeResumeSection = state.activeResumeSection === index ? null : index;
    updateResumeHighlight();
    renderResumeHint();
    saveState();
  });
  return button;
}

function updateResumeHighlight() {
  resumeViewer.querySelectorAll(".resume-section").forEach((sectionButton, index) => {
    sectionButton.dataset.active = String(state.activeResumeSection === index);
  });
}

function renderResumeHint() {
  resumeHint.textContent = state.activeResumeSection
    ? "当前高亮片段会随下一轮对话发送给面试官。"
    : "点击一段简历内容，标记面试官正在追问的部分。";
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
    scenario: state.scenario,
    role: state.role,
    profile: state.profile,
    resume: {
      name: state.resumeName,
      text: state.resumeText.slice(0, 12000),
      activeSection:
        typeof state.activeResumeSection === "number" ? state.resumeSections[state.activeResumeSection] : "",
    },
    messages: state.messages.filter((message) => ["user", "assistant"].includes(message.role)).slice(-12),
  };
}

async function sendMessage(text) {
  stopTimer();
  state.messages.push({ role: "user", content: text });
  render();
  setSending(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "模型服务暂时不可用。");
    }

    state.messages.push({ role: "assistant", content: data.reply || "我没有收到有效回复，请再试一次。" });
    startPrepTimer();
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

clearButton.addEventListener("click", () => {
  state.messages = [welcomeMessage];
  stopTimer();
  render();
});

trainingModeSelect.addEventListener("change", () => {
  state.trainingMode = trainingModeSelect.value;
  state.scenario = state.trainingMode === "resume" ? "项目经历追问" : "保研面试";
  render();
});

scenarioSelect.addEventListener("change", () => {
  state.scenario = scenarioSelect.value;
  render();
});

roleInput.addEventListener("input", () => {
  state.role = roleInput.value.trim() || "计算机专业大三学生";
  saveState();
});

profileInput.addEventListener("input", () => {
  state.profile = profileInput.value.trim();
  saveState();
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
    state.activeResumeSection = null;
    isFormattingResume = false;
    render();
  } catch (error) {
    setResumeStatus(`解析失败：${error.message}`);
  } finally {
    confirmResumeUploadButton.disabled = false;
    resumeUpload.disabled = false;
    resumeUpload.value = "";
    resumeConfig.classList.toggle("is-loading", false);
  }
});

clearHighlightButton.addEventListener("click", () => {
  state.activeResumeSection = null;
  render();
});

clearResumeButton.addEventListener("click", () => {
  state.resumeName = "";
  state.resumeText = "";
  state.resumeSections = [];
  state.activeResumeSection = null;
  resumeUpload.value = "";
  setResumeStatus("请选择文字版 PDF 简历。");
  render();
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

render();
