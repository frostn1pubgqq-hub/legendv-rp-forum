const $ = (s) => document.querySelector(s);
const categoriesEl = $("#categories");
const topicsEl = $("#topics");
const authDialog = $("#authDialog");
const topicDialog = $("#topicDialog");
const viewDialog = $("#viewDialog");

let currentUser = null;
let categories = [];
let authMode = "login";

const icons = ["📰","📜","🎮","🏛️","🕶️","📖","⚖️","📝","🛠️","💡"];

async function api(url, options = {}) {
  const response = await fetch("/api" + url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    credentials: "same-origin"
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Произошла ошибка.");
  return data;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showError(selector, message = "") {
  $(selector).textContent = message;
}

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(value.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      });
}

function updateWelcome() {
  $("#welcome").textContent = currentUser
    ? `Добро пожаловать, ${currentUser.username}! Ваша роль: ${currentUser.role === "admin" ? "администратор" : "участник"}.`
    : "Добро пожаловать на форум LegendV RP! Войдите или создайте аккаунт, чтобы участвовать в обсуждениях.";
  $("#authButton").textContent = currentUser
    ? `Выйти (${currentUser.username})`
    : "Войти";
}

async function loadCategories() {
  categories = await api("/categories");
  categoriesEl.innerHTML = categories.map((name, i) => `
    <a class="category" href="#topicsList" data-category="${escapeHTML(name)}">
      <span class="category-icon">${icons[i] || "✦"}</span>
      <span>
        <strong>${escapeHTML(name)}</strong>
        <small>Открыть раздел →</small>
      </span>
    </a>
  `).join("");

  $("#topicCategory").innerHTML = categories.map(name =>
    `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`
  ).join("");
}

function topicCard(topic) {
  const admin = currentUser && currentUser.role === "admin";
  const canDelete = currentUser &&
    (admin || currentUser.id === topic.user_id);

  return `
    <article class="topic" id="topic-${topic.id}">
      <div>
        <h3>
          ${topic.pinned ? "📌 " : ""}
          <a href="#topic-${topic.id}" data-view="${topic.id}">
            ${escapeHTML(topic.title)}
          </a>
        </h3>
        <p>${escapeHTML(topic.body.slice(0, 160))}${topic.body.length > 160 ? "…" : ""}</p>
        <div class="topic-meta">
          ${escapeHTML(topic.category)} · ${escapeHTML(topic.username)}
          · ${dateLabel(topic.created_at)} · Ответов: ${topic.replies || 0}
        </div>
      </div>
      <div class="topic-actions">
        <button class="small-button" data-view="${topic.id}">Открыть</button>
        ${admin ? `<button class="small-button" data-pin="${topic.id}">${topic.pinned ? "Открепить" : "Закрепить"}</button>` : ""}
        ${canDelete ? `<button class="small-button" data-delete="${topic.id}">Удалить</button>` : ""}
      </div>
    </article>
  `;
}

async function loadTopics(category = "") {
  topicsEl.textContent = "Загрузка обсуждений…";
  try {
    const topics = await api("/topics");
    const filtered = category
      ? topics.filter(topic => topic.category === category)
      : topics;

    topicsEl.id = "topicsList";
    topicsEl.innerHTML = filtered.length
      ? filtered.map(topicCard).join("")
      : `<p class="welcome">В этом разделе пока нет тем. Создай первую!</p>`;
  } catch (error) {
    topicsEl.textContent = error.message;
  }
}

async function refresh() {
  try {
    currentUser = await api("/me");
    updateWelcome();
    await loadTopics();
  } catch (error) {
    console.error(error);
    topicsEl.textContent = "Не удалось подключиться к серверу. Попробуйте обновить страницу.";
  }
}

function openAuth(mode) {
  authMode = mode;
  $("#authTitle").textContent = mode === "login"
    ? "Войти на форум"
    : "Создать аккаунт";
  $("#authForm button[type=submit]").textContent = mode === "login"
    ? "Войти"
    : "Зарегистрироваться";
  $("#switchAuth").textContent = mode === "login"
    ? "Нет аккаунта? Зарегистрироваться"
    : "Уже есть аккаунт? Войти";
  showError("#authError");
  authDialog.showModal();
}

$("#authButton").addEventListener("click", async () => {
  if (!currentUser) return openAuth("login");

  if (confirm("Выйти из аккаунта?")) {
    try {
      await api("/logout", { method: "POST", body: "{}" });
      currentUser = null;
      updateWelcome();
      await loadTopics();
    } catch (error) {
      alert(error.message);
    }
  }
});

$("#registerButton").addEventListener("click", () => openAuth("register"));

$("#switchAuth").addEventListener("click", () => {
  openAuth(authMode === "login" ? "register" : "login");
});

$("#authForm").addEventListener("submit", async event => {
  event.preventDefault();
  showError("#authError");

  const form = new FormData(event.currentTarget);
  const payload = {
    username: form.get("username"),
    password: form.get("password")
  };

  try {
    currentUser = await api(
      authMode === "login" ? "/login" : "/register",
      { method: "POST", body: JSON.stringify(payload) }
    );
    authDialog.close();
    event.currentTarget.reset();
    updateWelcome();
    await loadTopics();
  } catch (error) {
    showError("#authError", error.message);
  }
});

$("#newTopicButton").addEventListener("click", () => {
  if (!currentUser) {
    openAuth("login");
    return;
  }
  showError("#topicError");
  topicDialog.showModal();
});

$("#topicForm").addEventListener("submit", async event => {
  event.preventDefault();
  showError("#topicError");

  const form = new FormData(event.currentTarget);
  const payload = {
    title: form.get("title"),
    category: form.get("category"),
    body: form.get("body")
  };

  try {
    await api("/topics", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    topicDialog.close();
    event.currentTarget.reset();
    await loadTopics();
  } catch (error) {
    showError("#topicError", error.message);
  }
});

document.addEventListener("click", async event => {
  const close = event.target.closest("[data-close]");
  if (close) {
    const dialog = close.closest("dialog");
    if (dialog) dialog.close();
    return;
  }

  const categoryLink = event.target.closest("[data-category]");
  if (categoryLink) {
    event.preventDefault();
    await loadTopics(categoryLink.dataset.category);
    $("#topicsList").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    try {
      const topic = await api("/topics/" + viewButton.dataset.view);
      $("#topicView").innerHTML = `
        <span class="eyebrow">${escapeHTML(topic.category)}</span>
        <h2>${escapeHTML(topic.title)}</h2>
        <p class="topic-meta">Автор: ${escapeHTML(topic.username)} · ${dateLabel(topic.created_at)}</p>
        <div class="reply">${escapeHTML(topic.body).replace(/\n/g, "<br>")}</div>
        <h3>Ответы (${topic.replies.length})</h3>
        ${topic.replies.map(reply => `
          <div class="reply">
            <strong>${escapeHTML(reply.username)}</strong>
            <p>${escapeHTML(reply.body).replace(/\n/g, "<br>")}</p>
            <small class="topic-meta">${dateLabel(reply.created_at)}</small>
          </div>
        `).join("")}
        ${currentUser ? `
          <form id="replyForm">
            <label>Ваш ответ
              <textarea name="body" maxlength="3000" rows="3" required></textarea>
            </label>
            <button class="button" type="submit">Отправить ответ</button>
            <p id="replyError" class="error"></p>
          </form>
        ` : `<p>Войдите, чтобы отвечать в обсуждении.</p>`}
      `;

      $("#replyForm")?.addEventListener("submit", async e => {
        e.preventDefault();
        const body = new FormData(e.currentTarget).get("body");
        const error = $("#replyError");
        try {
          await api(`/topics/${topic.id}/replies`, {
            method: "POST",
            body: JSON.stringify({ body })
          });
          await loadTopics();
          viewDialog.close();
          alert("Ответ опубликован!");
        } catch (err) {
          error.textContent = err.message;
        }
      });

      viewDialog.showModal();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  const pinButton = event.target.closest("[data-pin]");
  if (pinButton) {
    try {
      await api(`/topics/${pinButton.dataset.pin}/pin`, {
        method: "POST",
        body: "{}"
      });
      await loadTopics();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton && confirm("Удалить эту тему вместе с ответами?")) {
    try {
      await api(`/topics/${deleteButton.dataset.delete}`, {
        method: "DELETE"
      });
      await loadTopics();
    } catch (error) {
      alert(error.message);
    }
  }
});

async function init() {
  try {
    await loadCategories();
    await refresh();
  } catch (error) {
    topicsEl.textContent = "Не удалось загрузить форум. Проверьте настройки сервера.";
    console.error(error);
  }
}

init();

async function setupAdminPanel() {
  const panel = document.getElementById("adminPanel");
  const usernameInput = document.getElementById("adminUsername");
  const message = document.getElementById("adminPanelMessage");
  const giveButton = document.getElementById("giveAdminBtn");
  const removeButton = document.getElementById("removeAdminBtn");

  if (!panel || !usernameInput || !message ||
      !giveButton || !removeButton) return;

  try {
    const response = await fetch("/api/me");
    const data = await response.json();
    const user = data.user || data;

    if (response.ok && user && user.role === "admin") {
      panel.hidden = false;
    } else {
      return;
    }
  } catch {
    return;
  }

  async function changeRole(role) {
    const username = usernameInput.value.trim();

    if (!username) {
      message.textContent = "Введи ник игрока.";
      return;
    }

    giveButton.disabled = true;
    removeButton.disabled = true;
    message.textContent = "Обрабатываем запрос...";

    try {
      const response = await fetch("/api/admin/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, role })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Не удалось изменить права.");
      }

      message.textContent =
        role === "admin"
          ? `Игрок ${result.username} теперь администратор.`
          : `У игрока ${result.username} сняты права администратора.`;

      usernameInput.value = "";
    } catch (error) {
      message.textContent = error.message || "Ошибка запроса.";
    } finally {
      giveButton.disabled = false;
      removeButton.disabled = false;
    }
  }

  giveButton.addEventListener("click", () => changeRole("admin"));
  removeButton.addEventListener("click", () => changeRole("user"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupAdminPanel);
} else {
  setupAdminPanel();
}
