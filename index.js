require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { MessagingResponse } = require("twilio").twiml;
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---- App & Middleware ----
const app = express();
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: false }));

// Validate Twilio signature (skip in local dev if no AUTH token)
const authToken = process.env.TWILIO_AUTH_TOKEN;
if (authToken) {
  app.post(
    "/whatsapp",
    twilio.webhook({ validate: true, protocol: "https" }),
    handler
  );
} else {
  app.post("/whatsapp", handler); // dev fallback
}

// ---- Data Store (simple JSON; consider SQLite for prod) ----
const dataDir = "./public";
const dataFile = path.join(dataDir, "data.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({}), "utf8");

// lightweight sync read/write (ok for single instance)
function readData() {
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}
function writeData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf8");
}

// ---- Helpers ----
const SG_TZ = "Asia/Singapore";
function startOfWeek(date = new Date()) {
  // Monday-start week in SG time
  const sg = new Date(date.toLocaleString("en-SG", { timeZone: SG_TZ }));
  const day = (sg.getDay() + 6) % 7; // 0=Mon … 6=Sun
  sg.setHours(0, 0, 0, 0);
  sg.setDate(sg.getDate() - day);
  return sg;
}
function startOfMonth(date = new Date()) {
  const sg = new Date(date.toLocaleString("en-SG", { timeZone: SG_TZ }));
  sg.setHours(0, 0, 0, 0);
  sg.setDate(1);
  return sg;
}
function withinRange(iso, from, to) {
  const d = new Date(iso);
  return d >= from && d <= to;
}
function fmt(n) {
  return `S$${Number(n).toFixed(2)}`;
}
function tokenizeUser(id) {
  // never expose phone; give them a stable pseudonymous token
  const secret = process.env.SUMMARY_SALT || "dev-salt";
  return crypto.createHmac("sha256", secret).update(id).digest("hex").slice(0, 24);
}
function parseAdd(text) {
  // Accept: "Add 3.5 kopi", "Add S$4.20 lunch", "add $5", "add 12 milk tea"
  // Amount first number; rest is category
  const m = text.match(/add\s*(?:s?\$)?\s*(\d+(?:\.\d{1,2})?)\s*(.*)/i);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const category = (m[2] || "uncategorised").trim() || "uncategorised";
  return { amount, category };
}
function renderMenu() {
  return [
    "👵 *Auntie Can Count One Menu:*",
    "- *Add* → Record an expense (e.g. Add S$5 kopi)",
    "- *Summary* → This week total",
    "- *Summary month* → This month total",
    "- *List* → Last 5 records",
    "- *Undo* → Remove last entry",
    "- *Tip* → Savings advice",
    "",
    "Example:  Add S$3 lunch",
  ].join("\n");
}

// ---- Main Handler ----
function handler(req, res) {
  const from = req.body.From || ""; // e.g. "whatsapp:+6591234567"
  const body = String(req.body.Body || "").trim();
  const twiml = new MessagingResponse();
  const reply = twiml.message();

  if (!from) {
    reply.body("Aiyo, cannot identify you. Please try again later.");
    return res.type("text/xml").send(twiml.toString());
  }

  const all = readData();
  if (!all.users) all.users = {};
  if (!all.users[from]) {
    all.users[from] = { token: tokenizeUser(from), entries: [] };
    writeData(all);
  }

  const user = all.users[from];
  const text = body.toLowerCase();

  // --- Commands ---
  if (text === "menu" || text === "help") {
    reply.body(renderMenu());
  }

  else if (text.startsWith("add")) {
    const parsed = parseAdd(body);
    if (!parsed) {
      reply.body("Say properly lah 😅 Example:  Add S$4 coffee");
    } else {
      const entry = {
        category: parsed.category.toLowerCase(),
        amount: parsed.amount,
        date: new Date().toISOString(),
      };
      user.entries.push(entry);
      writeData(all);
      reply.body(`Okay lah! Added ${fmt(entry.amount)} for ${entry.category} ✅`);
    }
  }

  else if (text === "list") {
    if (user.entries.length === 0) {
      reply.body("Aiyo, no record yet 😅 Try *Add S$5 lunch* first!");
    } else {
      const last = [...user.entries].slice(-5).reverse();
      const lines = last.map((e, i) => {
        const d = new Date(e.date).toLocaleString("en-SG", { timeZone: SG_TZ, hour12: false });
        return `${i + 1}. ${e.category} — ${fmt(e.amount)}  (${d})`;
      });
      reply.body(["🗃️ *Last 5 Records:*", ...lines].join("\n"));
    }
  }

  else if (text === "undo") {
    if (user.entries.length === 0) {
      reply.body("Nothing to undo lah 😅");
    } else {
      const removed = user.entries.pop();
      writeData(all);
      reply.body(`Undo ok: removed ${fmt(removed.amount)} for ${removed.category} ✅`);
    }
  }

  else if (text.includes("summary")) {
    const now = new Date();
    const rangeStart = text.includes("month") ? startOfMonth(now) : startOfWeek(now);
    const rangeEnd = now;

    const entries = user.entries.filter(e => withinRange(e.date, rangeStart, rangeEnd));
    if (entries.length === 0) {
      const label = text.includes("month") ? "this month" : "this week";
      reply.body(`No spending ${label} yet. Try *Add S$5 lunch* to start!`);
    } else {
      const totals = {};
      let total = 0;
      for (const e of entries) {
        totals[e.category] = (totals[e.category] || 0) + e.amount;
        total += e.amount;
      }

      const header = text.includes("month")
        ? "🧾 *Your Spending Summary This Month:*"
        : "🧾 *Your Spending Summary This Week:*";

      const lines = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `${cat}: ${fmt(amt)}`);

      let out = [header, ...lines, ``, `💰 *Total: ${fmt(total)}*`, `Steady lah, watch your spending 💪`].join("\n");

      // Safer summary link (token, not phone)
      out += `\n\n📊 Full summary 👉 https://auntie-bot.onrender.com/summary.html?u=${user.token}`;
      reply.body(out);
    }
  }

  else if (text.includes("tip")) {
    const tips = [
      "💡 Don’t buy kopi every day lah, can save a lot one!",
      "💡 Use cashback wisely — don’t overspend just to earn cents 😅",
      "💡 Cook at home sometimes — hawker bills add up!",
      "💡 Before buying a gadget, ask: *need or want?* 😉",
    ];
    reply.body(tips[Math.floor(Math.random() * tips.length)]);
  }

  else {
    reply.body(`Hello dear 👋 Auntie here to help you track your money.\nType *menu* to see options lah!`);
  }

  res.type("text/xml").send(twiml.toString());
}

// ---- Minimal read-only summary API (by token) ----
// You can let your static /summary.html fetch this endpoint securely.
app.get("/api/summary", (req, res) => {
  const token = String(req.query.u || "");
  if (!token) return res.status(400).json({ error: "missing token" });

  const all = readData();
  const entry = Object.values(all.users || {}).find(u => u.token === token);
  if (!entry) return res.status(404).json({ error: "not found" });

  res.json({
    entries: entry.entries,
    tz: SG_TZ,
    generatedAt: new Date().toISOString(),
  });
});

// ---- Health ----
app.get("/", (req, res) => res.type("text/plain").send("Auntie Can Count One is online 👵"));
app.get("/health", (_req, res) => res.sendStatus(200));

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie Can Count One (SGD) running on ${PORT}`));