const root = document.documentElement;
const themeToggle = document.querySelector("#themeToggle");
const themeIcon = document.querySelector("#themeIcon");
const statusPanel = document.querySelector(".status-panel");
const statusButton = document.querySelector("#statusButton");
const statusTitle = document.querySelector("#statusTitle");
const statusText = document.querySelector("#statusText");
const countValue = document.querySelector("#countValue");
const countBadge = document.querySelector("#countBadge");
const plusButton = document.querySelector("#plusButton");
const minusButton = document.querySelector("#minusButton");
const resetButton = document.querySelector("#resetButton");
const todoForm = document.querySelector("#todoForm");
const todoInput = document.querySelector("#todoInput");
const todoList = document.querySelector("#todoList");
const todoCount = document.querySelector("#todoCount");

const storageKey = "starter-web-ui";
const defaultState = {
  dark: false,
  paused: false,
  count: 0,
  todos: [
    { id: crypto.randomUUID(), text: "确认页面可访问", done: true },
    { id: crypto.randomUUID(), text: "修改文案并刷新页面", done: false },
  ],
};

let state = loadState();

function loadState() {
  const saved = localStorage.getItem(storageKey);

  if (!saved) {
    return defaultState;
  }

  try {
    return { ...defaultState, ...JSON.parse(saved) };
  } catch {
    return defaultState;
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function render() {
  root.classList.toggle("dark", state.dark);
  themeIcon.textContent = state.dark ? "☼" : "☾";

  statusPanel.classList.toggle("paused", state.paused);
  statusTitle.textContent = state.paused ? "状态已暂停" : "网站已启动";
  statusText.textContent = state.paused ? "交互状态已切换，服务仍在运行。" : "监听外部网络地址，前端交互可用。";

  countValue.textContent = state.count;
  countBadge.textContent = state.count;

  todoList.replaceChildren(...state.todos.map(createTodoItem));
  todoCount.textContent = `${state.todos.length} 项`;

  saveState();
}

function createTodoItem(todo) {
  const item = document.createElement("li");
  item.className = `todo-item${todo.done ? " done" : ""}`;

  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = todo.done;
  checkbox.addEventListener("change", () => {
    state.todos = state.todos.map((entry) => (entry.id === todo.id ? { ...entry, done: checkbox.checked } : entry));
    render();
  });

  const text = document.createElement("span");
  text.textContent = todo.text;
  label.append(checkbox, text);

  const removeButton = document.createElement("button");
  removeButton.className = "remove-button";
  removeButton.type = "button";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", `删除 ${todo.text}`);
  removeButton.addEventListener("click", () => {
    state.todos = state.todos.filter((entry) => entry.id !== todo.id);
    render();
  });

  item.append(label, removeButton);
  return item;
}

themeToggle.addEventListener("click", () => {
  state.dark = !state.dark;
  render();
});

statusButton.addEventListener("click", () => {
  state.paused = !state.paused;
  render();
});

plusButton.addEventListener("click", () => {
  state.count += 1;
  render();
});

minusButton.addEventListener("click", () => {
  state.count -= 1;
  render();
});

resetButton.addEventListener("click", () => {
  state.count = 0;
  render();
});

todoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = todoInput.value.trim();

  if (!text) {
    return;
  }

  state.todos = [{ id: crypto.randomUUID(), text, done: false }, ...state.todos];
  todoInput.value = "";
  render();
});

render();
