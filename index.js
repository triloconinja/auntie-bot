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
function fmt(n) {
  return `S$${Number(n).toFixed(2)}`;
}
function tokenizeUser(id) {
  const secret = process.env.SUMMARY_SALT || "dev-salt";
  return crypto.createHmac("sha256", secret).update(id).digest("hex").slice(0, 24);
}
function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// Amount-first parser (no 'add' needed)
function parseAmountFirst(text) {
  const m = text.match(/^\s*(?:s?\$)?\s*(\d+(?:[.,]\d{1,2})?)\b\s*(.*)$/i);
  if (!m) return null;
  const raw = m[1].replace(",", ".");
  const amount = parseFloat(raw);
  if (isNaN(amount)) return null;
  const category = (m[2] || "uncategorised").trim() || "uncategorised";
  return { amount, category };
}

function getTodayCount(entries) {
  if (!entries || !entries.length) return 0;
  const start = toSGDate();
  start.setHours(0, 0, 0, 0);
  const end = toSGDate();
  end.setHours(23, 59, 59, 999);
  return entries.filter(e => withinRange(e.date, start, end)).length;
}

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Witty Auntie Language Packs (20 each) ----

// Add messages split by amount tiers
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
];

// Headers/footers for summaries
const SUMMARY_WEEK_HEADERS = [
  "🧾 *This Week Summary*",
  "🧾 *Weekly Rundown*",
  "🧾 *Your Week in Dollars*",
  "🧾 *Auntie’s Weekly Report*",
  "🧾 *Weekly Wallet Story*",
  "🧾 *This Week Damage*",
  "🧾 *Week Spend Chart*",
  "🧾 *Weekly Tally*",
  "🧾 *Week at a Glance*",
  "🧾 *Weekly Checkout*",
  "🧾 *Pocket Diary (Week)*",
  "🧾 *Week Summary Can One*",
  "🧾 *This Week’s Kopi Count*",
  "🧾 *Week Spend Breakdown*",
  "🧾 *Weekly Finance Gossip*",
  "🧾 *Short Week Recap*",
  "🧾 *Weekly Budget Pulse*",
  "🧾 *Your Week, Your $*",
  "🧾 *Week: Where Money Went*",
  "🧾 *Auntie’s Week Audit*",
];
const SUMMARY_MONTH_HEADERS = [
  "🧾 *This Month Summary*",
  "🧾 *Monthly Rundown*",
  "🧾 *Your Month in Dollars*",
  "🧾 *Auntie’s Monthly Report*",
  "🧾 *Monthly Wallet Story*",
  "🧾 *This Month Damage*",
  "🧾 *Month Spend Chart*",
  "🧾 *Monthly Tally*",
  "🧾 *Month at a Glance*",
  "🧾 *Monthly Checkout*",
  "🧾 *Pocket Diary (Month)*",
  "🧾 *Month Summary Can One*",
  "🧾 *This Month’s Kopi Count*",
  "🧾 *Month Spend Breakdown*",
  "🧾 *Monthly Finance Gossip*",
  "🧾 *Long Month Recap*",
  "🧾 *Monthly Budget Pulse*",
  "🧾 *Your Month, Your $*",
  "🧾 *Month: Where Money Went*",
  "🧾 *Auntie’s Month Audit*",
];
const SUMMARY_FOOTERS = [
  "Steady lah, watch your spending 💪",
  "Little by little become mountain 🏔️",
  "Budget got eyes one — good job 👀",
  "Track now, enjoy later 🎯",
  "Discipline today, freedom tomorrow 🚀",
  "Wallet say thank you 🙏",
  "Savings also need protein — keep feeding 💪",
  "You + Auntie = Power duo ⚡",
  "Your future self clap for you 👏",
  "Nice lah, consistent like MRT timing (usually) 🚈",
  "Don’t let promo code control you 😜",
  "Treat yourself, but treat savings also 🐷",
  "Bao jiak plan — continue like this 🍱",
  "Clean like kopi-o kosong ☕",
  "You’re the CFO of your life 🧠",
  "Kiasu with money is good kind 👍",
  "Wallet doing push-ups now 🏋️",
  "Huat slowly but surely 🧧",
  "From cents to sense 🧩",
  "Auntie proud of you 🥹",
];

// List intros
const LIST_HEADERS = [
  "🗃️ *Last 5 Records:*",
  "🗂️ *Most Recent Entries:*",
  "📒 *Your Latest 5:*",
  "📘 *Fresh from the wallet:*",
  "📚 *Recent Expense Diary:*",
  "📝 *Top 5 Newest:*",
  "📄 *New Entries:*",
  "🧾 *Latest Log:*",
  "📋 *Quick Peek (5):*",
  "📗 *Fresh Logs:*",
  "📙 *Newest Five:*",
  "📔 *Kopi Book Entries:*",
  "📓 *Latest Notes:*",
  "🗒️ *Recent Spending:*",
  "🧰 *Fresh Items:*",
  "📎 *Just Added:*",
  "🧺 *New Baskets:*",
  "📥 *Incoming 5:*",
  "💳 *Recent Swipes:*",
  "📨 *Latest Records:*",
];

// Undo lines (20)
const UNDO_LINES = [
  "Undo ok: removed {AMT} for {CAT} ✅",
  "Reverse gear engaged — {CAT} {AMT} deleted 🔄",
  "Poof! {CAT} {AMT} disappear liao ✨",
  "Back in time: {AMT} on {CAT} undone ⏪",
  "Auntie erase clean — {CAT} {AMT} 🧽",
  "Cancelled like bad plan — {AMT} {CAT} ❌",
  "Unspend vibes: {CAT} {AMT} undo done 🪄",
  "Operation control-Z: {AMT} {CAT} ✅",
  "Gone like yesterday’s promo — {CAT} {AMT} 🏃",
  "Delete already, no cry — {AMT} {CAT} 🧊",
  "Removed liao: {CAT} {AMT}. Carry on 💼",
  "Entry out! {AMT} {CAT} 🗑️",
  "Scratch that — {CAT} {AMT} revoked ✍️",
  "Roll back done — {AMT} on {CAT} ⤴️",
  "Settle finish — {CAT} {AMT} undone 👍",
  "Ctrl+Z magic — {AMT} {CAT} 🧙",
  "No more — {CAT} {AMT}. Clean sheet 📄",
  "Auntie tidy up — {AMT} {CAT} 🧹",
  "Unlogged successfully — {CAT} {AMT} ✅",
  "Rewind complete — {AMT} for {CAT} 🔁",
];

// 20 Tips
const TIPS = [
  "💡 Before buy, ask: need or want?",
  "💡 Order kopi kosong — sugar also cost money (and health).",
  "💡 Use cashbacks you already qualify for; don’t overspend to chase cents.",
  "💡 Meal prep two days a week — save $, save time.",
  "💡 Park small change into savings jar; digital or physical.",
  "💡 Unsubscribe from sale emails; less temptation, more savings.",
  "💡 Compare subscriptions yearly; cancel ghost ones.",
  "💡 Plan groceries; hungry shopping = overspending.",
  "💡 Set a fun budget — enjoy without guilt.",
  "💡 Track daily — awareness beats willpower.",
  "💡 Move big buys to 24-hour cooling off period.",
  "💡 Negotiate telco/insurance at renewal; loyalty tax is real.",
  "💡 Use public transport more days — small wins add up.",
  "💡 BYO bottle & mug — cheaper + greener.",
  "💡 Avoid BNPL for wants; interest hides in the shadows.",
  "💡 Set auto-transfer to savings on payday.",
  "💡 Look at cost-per-use, not just price.",
  "💡 Avoid random Deliveroo — walk, eat, save.",
  "💡 Write wishlists; buy next month if still want.",
  "💡 Treat bonuses like 80% save, 20% play.",
];

// Extra spice if user adds many items today
const TODAY_SPICE = [
  "Today you very hardworking tracking ah 👍",
  "Wah, today your expense diary on fire 🔥",
  "Steady lah — consistent logging is power ⚡",
  "Auntie clap for your discipline 👏",
  "Today you and Auntie best friends already 🤝",
  "Budget streak unlocked 🏅",
  "Your future self say thank you 🙏",
  "Solid logging — CFO material 🧠",
  "Sibei on — keep going 💪",
  "Tracking champion of the day 🏆",
];

// ---- Menu Renderer ----
function renderMenu() {
  return [
    "👵 *Auntie Can Count One Menu:*",
    "- *$20 kopi* or *20 lunch* → Record an expense",
    "- *Summary* → This week total",
    "- *Summary month* → This month total",
    "- *List* → Last 5 records",
    "- *Undo* → Remove last entry",
    "- *Tip* → Savings advice",
    "",
    "Examples:",
    "• 3.5 kopi",
    "• $4.20 lunch",
    "• S$12 Grab",
  ].join("\n");
}

// ---- Dynamic responders ----
function addResponse(amount, category, todayCountAfter) {
  const tier = amount >= 200 ? "ULTRA" : amount >= 50 ? "HIGH" : "NORMAL";
  const base =
    tier === "ULTRA" ? rand(ADD_ULTRA) :
    tier === "HIGH"  ? rand(ADD_HIGH)  :
                       rand(ADD_NORMAL);

  let line = base.replace("{AMT}", fmt(amount)).replace("{CAT}", escape(category.toLowerCase()));

  // add spice if user is logging a lot today
  if (todayCountAfter >= 3) {
    line += `\n${rand(TODAY_SPICE)}`;
  }
  return line;
}

function summaryResponse(isMonth, lines, total, token) {
  const header = isMonth ? rand(SUMMARY_MONTH_HEADERS) : rand(SUMMARY_WEEK_HEADERS);
  const footer = rand(SUMMARY_FOOTERS);
  let out = [header, ...lines, "", `💰 *Total: ${fmt(total)}*`, footer].join("\n");
  out += `\n\n📊 Full summary 👉 https://auntie-bot.onrender.com/summary.html?u=${token}`;
  return out;
}

function listResponse(items) {
  const head = rand(LIST_HEADERS);
  return [head, ...items].join("\n");
}

function undoResponse(amount, category) {
  return rand(UNDO_LINES)
    .replace("{AMT}", fmt(amount))
    .replace("{CAT}", escape(category.toLowerCase()));
}

// ---- Main Handler ----
function handler(req, res) {
  const from = req.body.From || ""; // e.g. "whatsapp:+6591234567"
  const body = String(req.body.Body || "").trim();
  const text = body.toLowerCase();
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
        return `${i + 1}. ${escape(e.category)} — ${fmt(e.amount)}  (${d})`;
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
        const cat = (e.category || "uncategorised").toLowerCase();
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

  // --- Amount-first capture (NO 'add' needed) ---
  else {
    const parsed = parseAmountFirst(body);
    if (parsed) {
      const entry = {
        category: parsed.category.toLowerCase(),
        amount: parsed.amount,
        date: new Date().toISOString(),
      };
      user.entries.push(entry);
      writeData(all);

      const todayCount = getTodayCount(user.entries); // after adding
      reply.body(addResponse(entry.amount, entry.category, todayCount));
    } else {
      reply.body(
        `Hello dear 👋 Auntie can record expenses if you start with the amount.\n` +
        `Examples:\n- *$5 kopi*\n- *20 lunch*\n- *S$4.50 taxi*\nType *menu* to see options lah!`
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

// ---- Health & Root ----
app.get("/", (_req, res) => res.type("text/plain").send("Auntie Can Count One is online 👵"));
app.get("/health", (_req, res) => res.sendStatus(200));

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie Can Count One (SGD) running on ${PORT}`));
