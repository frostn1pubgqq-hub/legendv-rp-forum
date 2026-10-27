
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "legendv.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user'
);
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

app.use(express.json({ limit: "100kb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 7 * 86400000 }
}));

const categories = [
  "Новости и обновления", "Правила проекта", "Игровые серверы",
  "Государственные организации", "Криминальные организации",
  "RP-биографии и ситуации", "Жалобы и обжалования",
  "Заявления и наборы", "Техническая поддержка",
  "Предложения и общение"
];

const getUser = id => db.prepare("SELECT id, username, role FROM users WHERE id=?").get(id);
const clean = (v, max = 3000) => typeof v === "string" ? v.trim().slice(0, max) : "";

app.get("/api/categories", (req, res) => res.json(categories));
app.get("/api/me", (req, res) => res.json(req.session.user || null));

app.post("/api/register", (req, res) => {
  const username = clean(req.body.username, 24);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username) || password.length < 8)
    return res.status(400).json({ error: "Ник: 3–24 символа (латиница, цифры, _ или -); пароль — от 8 символов." });

  const exists = db.prepare("SELECT id FROM users LIMIT 1").get();
  const hash = crypto.scryptSync(password, crypto.randomBytes(16), 32).toString("hex");
  const salt = crypto.randomBytes(16).toString("hex");
  const secureHash = crypto.scryptSync(password, salt, 32).toString("hex");

  try {
    const info = db.prepare("INSERT INTO users(username,password,role) VALUES(?,?,?)")
      .run(username, salt + ":" + secureHash, exists ? "user" : "admin");
    req.session.user = getUser(info.lastInsertRowid);
    res.json(req.session.user);
  } catch {
    res.status(409).json({ error: "Этот ник уже занят." });
  }
});

app.post("/api/login", (req, res) => {
  const username = clean(req.body.username, 24);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!user) return res.status(401).json({ error: "Неверный ник или пароль." });

  const [salt, saved] = user.password.split(":");
  const check = crypto.scryptSync(password, salt, 32).toString("hex");
  if (check !== saved) return res.status(401).json({ error: "Неверный ник или пароль." });

  req.session.user = getUser(user.id);
  res.json(req.session.user);
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/topics", (req, res) => {
  const topics = db.prepare(`
    SELECT t.*, COUNT(r.id) AS replies
    FROM topics t LEFT JOIN replies r ON r.topic_id=t.id
    GROUP BY t.id ORDER BY t.pinned DESC, t.id DESC
  `).all();
  res.json(topics);
});

app.post("/api/topics", (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: "Сначала войдите в аккаунт." });
  const title = clean(req.body.title, 120);
  const body = clean(req.body.body, 5000);
  const category = clean(req.body.category, 80);
  if (title.length < 3 || body.length < 3 || !categories.includes(category))
    return res.status(400).json({ error: "Проверьте название, текст и категорию." });

  const info = db.prepare(
    "INSERT INTO topics(user_id,username,title,body,category) VALUES(?,?,?,?,?)"
  ).run(user.id, user.username, title, body, category);
  res.json(db.prepare("SELECT * FROM topics WHERE id=?").get(info.lastInsertRowid));
});

app.get("/api/topics/:id", (req, res) => {
  const topic = db.prepare("SELECT * FROM topics WHERE id=?").get(req.params.id);
  if (!topic) return res.status(404).json({ error: "Тема не найдена." });
  topic.replies = db.prepare("SELECT * FROM replies WHERE topic_id=? ORDER BY id").all(topic.id);
  res.json(topic);
});

app.post("/api/topics/:id/replies", (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: "Сначала войдите в аккаунт." });
  const body = clean(req.body.body, 3000);
  const topic = db.prepare("SELECT id FROM topics WHERE id=?").get(req.params.id);
  if (!topic || body.length < 1) return res.status(400).json({ error: "Проверьте тему и сообщение." });
  const info = db.prepare(
    "INSERT INTO replies(topic_id,user_id,username,body) VALUES(?,?,?,?)"
  ).run(topic.id, user.id, user.username, body);
  res.json(db.prepare("SELECT * FROM replies WHERE id=?").get(info.lastInsertRowid));
});

app.delete("/api/topics/:id", (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: "Войдите в аккаунт." });
  const topic = db.prepare("SELECT * FROM topics WHERE id=?").get(req.params.id);
  if (!topic) return res.status(404).json({ error: "Тема не найдена." });
  if (topic.user_id !== user.id && user.role !== "admin")
    return res.status(403).json({ error: "Можно удалять только свои темы." });
  db.prepare("DELETE FROM replies WHERE topic_id=?").run(topic.id);
  db.prepare("DELETE FROM topics WHERE id=?").run(topic.id);
  res.json({ ok: true });
});

app.post("/api/topics/:id/pin", (req, res) => {
  const user = req.session.user;
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Только администратор." });
  const topic = db.prepare("SELECT id,pinned FROM topics WHERE id=?").get(req.params.id);
  if (!topic) return res.status(404).json({ error: "Тема не найдена." });
  db.prepare("UPDATE topics SET pinned=? WHERE id=?").run(topic.pinned ? 0 : 1, topic.id);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));


app.post("/api/admin/role", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Нужно войти в аккаунт" });
  }

  const actor = db.prepare(
    "SELECT id, username, role FROM users WHERE id = ?"
  ).get(req.session.user.id);

  if (!actor || actor.role !== "admin") {
    return res.status(403).json({ error: "Нет прав" });
  }

  const owner = db.prepare(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
  ).get();

  if (!owner || actor.id !== owner.id) {
    return res.status(403).json({
      error: "Управлять администраторами может только главный администратор"
    });
  }

  const username = String(req.body.username || "").trim();
  const role = req.body.role;

  if (!username || !["admin", "user"].includes(role)) {
    return res.status(400).json({ error: "Проверь ник и роль" });
  }

  const target = db.prepare(
    "SELECT id, username FROM users WHERE username = ? COLLATE NOCASE"
  ).get(username);

  if (!target) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }

  if (target.id === actor.id && role !== "admin") {
    return res.status(400).json({
      error: "Нельзя снять права главного администратора"
    });
  }

  db.prepare("UPDATE users SET role = ? WHERE id = ?")
    .run(role, target.id);

  res.json({
    ok: true,
    username: target.username,
    role
  });
});
app.listen(PORT, "0.0.0.0", () => console.log("LegendV RP запущен на порту " + PORT));
