const root = document.documentElement;
const themeToggle = document.querySelector("#themeToggle");
const themeIcon = document.querySelector("#themeIcon");
const clearButton = document.querySelector("#clearButton");
const scenarioSelect = document.querySelector("#scenarioSelect");
const roleInput = document.querySelector("#roleInput");
const profileInput = document.querySelector("#profileInput");
const prepSecondsInput = document.querySelector("#prepSecondsInput");
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
    scenario: "保研面试",
    role: "计算机专业大三学生",
    profile: "",
    prepSeconds: 5,
    timerVisible: true,
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
  scenarioSelect.value = state.scenario;
  roleInput.value = state.role;
  profileInput.value = state.profile;
  prepSecondsInput.value = state.prepSeconds;
  timerPanel.hidden = !state.timerVisible;
  showTimerButton.hidden = state.timerVisible;
  messagesEl.replaceChildren(...state.messages.map(createMessage));
  messagesEl.scrollTop = messagesEl.scrollHeight;
  renderTimer();
  saveState();
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
    scenario: state.scenario,
    role: state.role,
    profile: state.profile,
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
