// index.js
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

app.use((req, res, next) => {
  if (req.path === "/data.json") return res.sendStatus(404);
  next();
});

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: false }));

const authToken = process.env.TWILIO_AUTH_TOKEN; // if present, we validate Twilio signatures

// ---- Data Store (simple JSON; consider SQLite for prod) ----
const dataDir = "./public";
const dataFile = path.join(dataDir, "data.json");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify({}), "utf8");

function readData() {
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}
function writeData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf8");
}

// ---- Helpers ----
const SG_TZ = "Asia/Singapore";
function toSGDate(d = new Date()) {
  return new Date(new Date(d).toLocaleString("en-SG", { timeZone: SG_TZ }));
}
function startOfWeek(date = new Date()) {
  const sg = toSGDate(date);
  const day = (sg.getDay() + 6) % 7; // Monday=0
  sg.setHours(0, 0, 0, 0);
  sg.setDate(sg.getDate() - day);
  return sg;
}
function startOfMonth(date = new Date()) {
  const sg = toSGDate(date);
  sg.setHours(0, 0, 0, 0);
  sg.setDate(1);
  return sg;
}
function withinRange(iso, from, to) {
  const d = new Date(iso);
  return d >= from && d <= to;
}

/* Truncate to 2 decimals (NO rounding) and show 2dp */
function fmt(n) {
  const x = Number(n) || 0;
  const sign = x < 0 ? -1 : 1;
  const v = Math.floor(Math.abs(x) * 100) / 100;
  return `S$${(sign * v).toFixed(2)}`;
}

function tokenizeUser(id) {
  const secret = process.env.SUMMARY_SALT || "dev-salt";
  return crypto.createHmac("sha256", secret).update(id).digest("hex").slice(0, 24);
}
function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ===== Category + Amount parsing helpers ===== */

/* Keep letters, numbers, and single spaces; collapse multiples; trim; max 13 chars */
function normCat(s) {
  let t = String(s || "uncategorised");
  // allow spaces (requested), but remove all other specials
  t = t.replace(/[^A-Za-z0-9 ]+/g, ""); // keep A-Z a-z 0-9 and space
  t = t.replace(/\s+/g, " ").trim();    // collapse spaces
  if (!t) t = "uncategorised";
  return t.slice(0, 13);
}

/* Fix “spaced decimals”: e.g. 23 . 25 -> 23.25, 12 .5 -> 12.5 */
function fixSpacedDecimals(s) {
  return String(s).replace(/(\d+)\s*\.\s*(\d+)/g, "$1.$2");
}

/* Convert a numeric string to 2dp (truncate, no round).
   Handles commas as thousands or decimal:
   - If both ',' and '.' exist -> ',' = thousands (remove)
   - Else single ',' treated as decimal
*/
function normalizeAmountString(numStr) {
  let num = String(numStr).trim();
  
  // Always treat commas as thousand separators (never decimal)
  num = num.replace(/,/g, ""); // remove all commas

  const negative = num.startsWith("-");
  if (negative) num = num.slice(1);

  // ensure proper 2dp truncation
  if (num.includes(".")) {
    const [i, d = ""] = num.split(".");
    num = (negative ? "-" : "") + i + "." + d.slice(0, 2).padEnd(2, "0");
  } else {
    num = (negative ? "-" : "") + num + ".00";
  }

  const amount = parseFloat(num);
  return isNaN(amount) ? null : amount;
}


/* Amount-first: "23.356 movie", "$4.2 kopi", "1,234.9 laptop" */
function parseAmountFirst(text) {
  const m = String(text).match(/^\s*(?:-?\s*s?\$)?\s*(-?[0-9][0-9,]*(?:[.][0-9]+|[,][0-9]+)?)\s*(.*)$/i);
  if (!m) return null;
  const amount = normalizeAmountString(m[1]);
  if (amount === null) return null;
  const category = normCat((m[2] || "uncategorised").trim());
  return { amount, category };
}

/* Category-first: "shoes 200", "nike shoes $200", "pc repair S$133.78"
   - category can have spaces; amount must be at end
   - optional ":" or "-" before amount allowed
*/
function parseCategoryFirst(text) {
  const m = String(text).match(/^\s*(.*?)\s*(?:[:\-])?\s*(?:s?\$)?\s*(-?[0-9][0-9,]*(?:[.][0-9]+|[,][0-9]+)?)\s*$/i);
  if (!m) return null;
  const rawCat = m[1];
  if (!rawCat || !rawCat.trim()) return null;
  const amount = normalizeAmountString(m[2]);
  if (amount === null) return null;
  const category = normCat(rawCat);
  return { amount, category };
}

/* Master parser:
   1) Fix spaced decimals
   2) Try amount-first
   3) Else try category-first
*/
function parseExpense(text) {
  const t = fixSpacedDecimals(text);
  return parseAmountFirst(t) || parseCategoryFirst(t) || null;
}

/* ===== Other helpers ===== */
function getTodayCount(entries) {
  if (!entries || !entries.length) return 0;
  const start = toSGDate();
  start.setHours(0, 0, 0, 0);
  const end = toSGDate();
  end.setHours(23, 59, 59, 999);
  return entries.filter(e => withinRange(e.date, start, end)).length;
}
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ===========================
   Witty Auntie Language Packs
   (same expanded packs from your last file)
   =========================== */

const ADD_NORMAL = [
  "Okay lah! {AMT} for {CAT} masuk liao ✅",
  "Recorded! {CAT} — {AMT}. Steady bompi-pi 💪",
  "Auntie write down already: {CAT} {AMT} ✍️",
  "Noted ah! {AMT} for {CAT}. Don’t later say forget 😜",
  "Ka-ching! {CAT} at {AMT}. Wallet still breathing? 💸",
  "Shiok ah, {CAT} {AMT}. Small small also must track 👍",
  "Add done: {CAT} — {AMT}. You very on today!",
  "Auntie file inside liao: {AMT} {CAT} 🗂️",
  "Copy! {CAT} {AMT}. Next time jio Auntie kopi also 😆",
  "Registered hor: {AMT} for {CAT} ✅",
  "Boomz! {CAT} {AMT}. Budget warrior mode 🛡️",
  "Got it got it: {AMT} {CAT}. Spend smart ah 😉",
  "Swee! {CAT} {AMT}. Keep the habit going 👏",
  "Auntie stamp chop: {AMT} for {CAT} 🧾",
  "Entry added: {CAT} — {AMT}. Don’t anyhow whack ah!",
  "Ok can! {AMT} {CAT}. Save first, flex later 😎",
  "Auntie see already: {CAT} {AMT}. Jiayou!",
  "收到 (shou dao)! {AMT} for {CAT}.",
  "Mark down liao: {CAT} {AMT}. On track ah 🚶",
  "Nice one! {AMT} {CAT}. Dollar by dollar become mountain 🏔️",
  "Settle! {CAT} {AMT}. Solid like MRT timing 🚈",
  "Log finish — {CAT} {AMT}. Habits power lah ⚡",
  "Auntie pat your back: {CAT} {AMT} 👏",
  "Budget ninja move — {CAT} {AMT} 🥷",
  "Write liao write liao: {CAT} {AMT} ✒️",
  "Steady hands: {CAT} {AMT}. Track like pro 🧮",
  "Eh not bad — {CAT} {AMT}. Consistency champion 🏅",
  "Auntie save to book: {CAT} {AMT} 📘",
  "Got record then got control — {CAT} {AMT} 🎛️",
  "CFO vibes unlocked: {CAT} {AMT} 🧠",
  "Auntie say can! {CAT} {AMT} ✅",
  "Small small also count — {CAT} {AMT} 🔢",
  "Kopi reward later — now log {CAT} {AMT} ☕",
  "Boom, captured {CAT} {AMT}. Next! 📥",
  "Record clean clean — {CAT} {AMT} 🧼",
  "Auntie proud sia — {CAT} {AMT} 🥹",
  "Today very on — {CAT} {AMT} 🔥",
  "Cha-ching noted: {CAT} {AMT} 💳",
  "Book balance happy — {CAT} {AMT} 😊",
  "Track first, shiok later — {CAT} {AMT} ✨",
];

const ADD_HIGH = [
  "Wah {AMT} for {CAT}? Today treat yourself ah 🤭",
  "Oof, {AMT} on {CAT}. Heart pain a bit or not? 🫣",
  "Aiyo {AMT}! {CAT} premium version issit? 😅",
  "Steady lah big spender — {CAT} {AMT} 💼",
  "High SES vibes detected: {AMT} for {CAT} ✨",
  "Auntie faint a bit but record already: {AMT} {CAT} 😵‍💫",
  "Power sia! {CAT} {AMT}. Remember drink water also 💧",
  "Wallet say “eh bro…” — {AMT} {CAT} 😂",
  "Boom, {AMT} on {CAT}. Next week eat cai png plain rice? 🍚",
  "Ok lah, sometimes must enjoy — {CAT} {AMT} 🌟",
  "Uncle hear also stunned: {AMT} for {CAT} 😳",
  "Eh careful ah, BIG one: {AMT} {CAT} 🧨",
  "Luxury mode ON — {CAT} {AMT} 👜",
  "Shiok but pricey: {AMT} for {CAT}. Balance balance ya ⚖️",
  "Auntie log liao, you log out from Shopee ok? {AMT} {CAT} 😝",
  "Your card crying softly: {AMT} on {CAT} 😭",
  "Can can, recorded — {CAT} {AMT}. Next one cheap cheap pls 🙏",
  "Treat yo’ self completed: {AMT} {CAT} 🎉",
  "Big kahuna spend: {AMT} for {CAT}. Solid lah 💪",
  "Warning light blinking a bit: {AMT} {CAT} 🚨",
  "Today quite shiok ah — {CAT} {AMT}. Tomorrow save harder 🤝",
  "Wallet perspiring — {AMT} for {CAT} 🥵",
  "Auntie raise eyebrow but support — {AMT} {CAT} 🤨",
  "Reward yourself lah — {CAT} {AMT} ✅",
  "High tide spending — {CAT} {AMT} 🌊",
  "Budget engine rev high — {CAT} {AMT} 🏎️",
  "Big bite taken — {CAT} {AMT} 🍔",
  "Glam a bit can — {CAT} {AMT} ✨",
  "Eh careful later month end — {CAT} {AMT} 📆",
  "Steady hand, heavy price — {CAT} {AMT} 💵",
  "Spend got purpose then ok — {CAT} {AMT} 🎯",
  "Once in a while good one — {CAT} {AMT} 🌈",
  "Wah lau, still within plan? {CAT} {AMT} 📋",
  "Pocket feel thunder — {CAT} {AMT} ⛈️",
  "Ok lah, pamper a bit — {CAT} {AMT} 🫶",
  "Card swipe got smoke — {CAT} {AMT} 💨",
  "Later drink plain water balance — {CAT} {AMT} 🚰",
  "Note liao; aim no-spend day next ok? {AMT} {CAT} 🗓️",
  "Use till song, don’t waste — {CAT} {AMT} 👍",
  "Big mood purchase — {CAT} {AMT} 😎",
];

const ADD_ULTRA = [
  "WAH LAO {AMT} for {CAT}?! Auntie need to sit down first 🪑",
  "Bank manager wave also cannot stop you: {AMT} {CAT} 🏦",
  "Confirm VIP already — {CAT} {AMT} 👑",
  "This one thunderclap spend ah: {AMT}! {CAT} ⚡",
  "Are you buying the shop or the {CAT}? {AMT} 😅",
  "Auntie record liao, but your wallet send SOS 📡 — {AMT} {CAT}",
  "Your money do parkour today: {AMT} on {CAT} 🤸",
  "Big dragon spend spotted: {AMT} {CAT} 🐉",
  "Huat ah or ouch ah? {AMT} for {CAT} 🧧",
  "Legendary purchase unlocked: {CAT} {AMT} 🏆",
  "This one no play play — {AMT} {CAT} 🚀",
  "Budget boss fight incoming after {AMT} on {CAT} 🕹️",
  "Wallet ICU level: {AMT} {CAT} 🏥",
  "Power ranger spend — {CAT} {AMT} ⚔️",
  "Earthquake on bank account richter scale {AMT} 🌋",
  "Siao liao, {AMT} for {CAT}. But Auntie proud you track 👍",
  "Steady like rock, spend like storm — {AMT} {CAT} 🌪️",
  "Confirm got cashback? Better have — {AMT} {CAT} 💳",
  "Auntie salute — {AMT} on {CAT}. Discipline still solid 🫡",
  "After this ah, drink tap water few days ok? {AMT} {CAT} 🚰",
  "Boss level purchase — {CAT} {AMT} 👔",
  "Card also shock — {AMT} for {CAT} ⚡️",
  "Auntie jaw drop but log still — {AMT} {CAT} 😮",
  "VIP swipe detected — {CAT} {AMT} 🛂",
  "Big wave hit wallet — {CAT} {AMT} 🌊",
  "You unlock prestige tier — {CAT} {AMT} 🏅",
  "Sibeh big — {CAT} {AMT}. Breathe in, breathe out 🧘",
  "Price like roller coaster — {CAT} {AMT} 🎢",
  "Not everyday kind — {CAT} {AMT} 📆",
  "Confirm talk about this during CNY — {CAT} {AMT} 🧧",
  "Budget meteor strike — {CAT} {AMT} ☄️",
  "Wallet need spa after this — {AMT} {CAT} 🧖",
  "Power move sia — {CAT} {AMT} 🦾",
  "Gahmen also cannot help — {CAT} {AMT} 🏛️",
  "Card swipe sound like thunder — {CAT} {AMT} 🔊",
  "One step closer to minimalist — {CAT} {AMT} 🧹",
  "Hope got warranty hor — {CAT} {AMT} 🧾",
  "Make sure use until worth — {CAT} {AMT} ✅",
  "Auntie respect — {CAT} {AMT} 🙇",
  "Ok log liao, now hibernate spending a bit — {CAT} {AMT} 🐻",
];

const SUMMARY_WEEK_HEADERS = [ /* ...same expanded 40 as last message... */ ];
const SUMMARY_MONTH_HEADERS = [ /* ...same expanded 40 as last message... */ ];
const SUMMARY_FOOTERS = [ /* ...same expanded 40 as last message... */ ];
const LIST_HEADERS = [ /* ...same expanded 40 as last message... */ ];
const UNDO_LINES = [ /* ...same expanded 40 as last message... */ ];
const TIPS = [ /* ...same expanded 40 as last message... */ ];
const TODAY_SPICE = [ /* ...20 lines as last message... */ ];

/* ---- Menu Renderer ---- */
function renderMenu() {
  return [
    "👵 *Auntie Can Count One Menu:*",
    "- *$20 kopi* or *20 lunch* → Record an expense",
    "- *shoes 200* or *kopi $4.50* → Category first also can",
    "- *Summary* → This week total",
    "- *Summary month* → This month total",
    "- *List* → Last 5 records",
    "- *Undo* → Remove last entry",
    "- *Tip* → Savings advice",
    "",
    "Examples:",
    "• 3.5 kopi",
    "• $4.20 lunch",
    "• pc repair 133.78",
  ].join("\n");
}

/* ---- Dynamic responders ---- */
function addResponse(amount, category, todayCountAfter) {
  const tier = amount >= 200 ? "ULTRA" : amount >= 50 ? "HIGH" : "NORMAL";
  const base =
    tier === "ULTRA" ? rand(ADD_ULTRA) :
    tier === "HIGH"  ? rand(ADD_HIGH)  :
                       rand(ADD_NORMAL);

  const safeCat = normCat(category).toLowerCase();
  let line = base.replace("{AMT}", fmt(amount)).replace("{CAT}", escape(safeCat));
  if (todayCountAfter >= 3) line += `\n${rand(TODAY_SPICE)}`;
  return line;
}

function summaryResponse(isMonth, lines, total, token) {
  const header = isMonth ? rand(SUMMARY_MONTH_HEADERS) : rand(SUMMARY_WEEK_HEADERS);
  const footer = rand(SUMMARY_FOOTERS);
  let out = [header, ...lines, "", `💰 *Total: ${fmt(total)}*`, footer].join("\n");
  out += `\n\n📊 Full summary 👉 https://auntie-bot.onrender.com/summary.html?u=${token}`;
  return out;
}
function listResponse(items) { const head = rand(LIST_HEADERS); return [head, ...items].join("\n"); }
function undoResponse(amount, category) {
  const safeCat = normCat(category).toLowerCase();
  return rand(UNDO_LINES).replace("{AMT}", fmt(amount)).replace("{CAT}", escape(safeCat));
}

/* ---- Main Handler ---- */
function handler(req, res) {
  const from = req.body.From || ""; // e.g. "whatsapp:+6591234567"
  const body = String(req.body.Body || "").trim();
  const text = fixSpacedDecimals(body).toLowerCase();  // pre-fix decimals for command matching too
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

  // --- Commands take priority ---
  if (text === "menu" || text === "help") {
    reply.body(renderMenu());
  }
  else if (text === "list") {
    if (user.entries.length === 0) {
      reply.body("Aiyo, no record yet 😅 Try *$5 lunch* first!");
    } else {
      const last = [...user.entries].slice(-5).reverse();
      const lines = last.map((e, i) => {
        const d = new Date(e.date).toLocaleString("en-SG", { timeZone: SG_TZ, hour12: false });
        return `${i + 1}. ${escape(normCat(e.category).toLowerCase())} — ${fmt(e.amount)}  (${d})`;
      });
      reply.body(listResponse(lines));
    }
  }
  else if (text === "undo") {
    if (user.entries.length === 0) {
      reply.body("Nothing to undo lah 😅");
    } else {
      const removed = user.entries.pop();
      writeData(all);
      reply.body(undoResponse(removed.amount, removed.category));
    }
  }
  else if (text.includes("summary")) {
    const now = new Date();
    const isMonth = text.includes("month");
    const rangeStart = isMonth ? startOfMonth(now) : startOfWeek(now);
    const rangeEnd = now;

    const entries = user.entries.filter(e => withinRange(e.date, rangeStart, rangeEnd));
    if (entries.length === 0) {
      const label = isMonth ? "this month" : "this week";
      reply.body(`No spending ${label} yet. Try *$5 lunch* to start!`);
    } else {
      const totals = {};
      let total = 0;
      for (const e of entries) {
        const cat = normCat(e.category || "uncategorised").toLowerCase();
        totals[cat] = (totals[cat] || 0) + Number(e.amount || 0);
        total += Number(e.amount || 0);
      }
      const lines = Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `${escape(cat)}: ${fmt(amt)}`);

      reply.body(summaryResponse(isMonth, lines, total, user.token));
    }
  }
  else if (text.includes("tip")) {
    reply.body(rand(TIPS));
  }

  // --- Capture expense (amount-first OR category-first) ---
  else {
    const parsed = parseExpense(body);
    if (parsed) {
      const entry = {
        category: normCat(parsed.category).toLowerCase(), // keep spaces, alnum-only, max 13
        amount: parsed.amount,
        date: new Date().toISOString(),
      };
      user.entries.push(entry);
      writeData(all);

      const todayCount = getTodayCount(user.entries); // after adding
      reply.body(addResponse(entry.amount, entry.category, todayCount));
    } else {
      reply.body(
        `Hello dear 👋 Start with amount *or* category.\n` +
        `Examples:\n- *$5 kopi*  (amount first)\n- *pc repair 133.78*  (category first)\n- *shoes $200*\nType *menu* to see options lah!`
      );
    }
  }

  res.type("text/xml").send(twiml.toString());
}

// Attach the webhook with optional validation
if (authToken) {
  app.post("/whatsapp", twilio.webhook({ validate: true, protocol: "https" }), handler);
} else {
  app.post("/whatsapp", handler); // dev fallback
}

// ---- Clear a user's entries (by summary token) ----
app.post("/api/clear", express.json(), (req, res) => {
  try {
    const { u } = req.body || {};
    if (!u || typeof u !== "string") {
      return res.status(400).json({ error: "missing token" });
    }

    const all = readData();
    const users = all.users || {};
    const pair = Object.entries(users).find(([_, v]) => v && v.token === u);
    if (!pair) return res.status(404).json({ error: "not found" });

    const [key, user] = pair;
    const before = Array.isArray(user.entries) ? user.entries.length : 0;
    users[key].entries = [];
    all.users = users;
    writeData(all);

    return res.status(200).json({ ok: true, cleared: true, countBefore: before });
  } catch (e) {
    console.error("clear error:", e);
    return res.status(500).json({ error: "failed to clear" });
  }
});

// ---- Feedback API (GET, paginated, read-only) ----
app.get("/api/feedback", (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limitRaw = parseInt(req.query.limit, 10) || 10;
    const limit = Math.min(50, Math.max(1, limitRaw)); // clamp 1..50

    const all = readData();
    const list = Array.isArray(all.feedback) ? all.feedback.slice() : [];

    // newest first
    list.sort((a, b) => {
      const ta = new Date(a.atServer || a.atClient || 0).getTime();
      const tb = new Date(b.atServer || b.atClient || 0).getTime();
      return tb - ta;
    });

    const total = list.length;
    const items = list.slice(offset, offset + limit).map(rec => ({
      id: rec.id || null,
      token: rec.token || null,   // safe to show truncated client-side
      page: rec.page || "summary",
      message: rec.message || "",
      atServer: rec.atServer || null,
      atClient: rec.atClient || null,
      // ip intentionally omitted
    }));

    res.json({ total, offset, limit, items });
  } catch (err) {
    console.error("feedback get error:", err);
    res.status(500).json({ error: "failed to read feedback" });
  }
});



// ---- Feedback API (JSON-in, stored in data.json) ----
app.post("/api/feedback", express.json(), (req, res) => {
  try {
    const { u, message, page, at } = req.body || {};
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    // keep message sane
    const safeMsg = message.trim().slice(0, 2000);

    // simple id
    const id =
      (crypto.randomUUID && crypto.randomUUID()) ||
      crypto
        .createHash("sha1")
        .update(`${Date.now()}-${Math.random()}`)
        .digest("hex")
        .slice(0, 12);

    // record
    const rec = {
      id,
      token: typeof u === "string" ? u : null,
      page: typeof page === "string" ? page : "summary",
      message: safeMsg,
      atClient: typeof at === "string" ? at : null,
      atServer: new Date().toISOString(),
      ip:
        (req.headers["x-forwarded-for"] &&
          String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
        (req.socket && req.socket.remoteAddress) ||
        null,
    };

    const all = readData();
    if (!all.feedback) all.feedback = [];
    all.feedback.push(rec);
    writeData(all);

    return res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error("feedback error:", err);
    return res.status(500).json({ error: "failed to save feedback" });
  }
});


// ---- Minimal read-only summary API (by token) ----
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



app.get("/admin/data.json", (req, res) => {
  const key = req.query.key || req.headers["x-admin-key"];
  if (!process.env.ADMIN_TOKEN || key !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const all = readData();
  res.json(all);
});


// ---- Health & Root ----
app.get("/", (_req, res) => res.type("text/plain").send("Auntie Can Count One is online 👵"));
app.get("/health", (_req, res) => res.sendStatus(200));

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie Can Count One (SGD) running on ${PORT}`));
