require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { MessagingResponse } = require("twilio").twiml;
const fs = require("fs");

const app = express();
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: false }));

// Simple JSON data file
const dataFile = "./public/data.json";
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, "[]");

function readData() {
  return JSON.parse(fs.readFileSync(dataFile));
}

function writeData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

app.post("/whatsapp", (req, res) => {
  const body = (req.body.Body || "").trim();
  const twiml = new MessagingResponse();
  const reply = twiml.message();

  // Help / Menu
  if (body.toLowerCase() === "menu" || body.toLowerCase() === "help") {
    reply.body(
      "👵 *Auntie Can Count One Menu:*\n" +
      "- Add → Record an expense (e.g. Add S$5 kopi)\n" +
      "- Budget → Set a budget (coming soon!)\n" +
      "- Summary → View your weekly spending\n" +
      "- Tips → Get daily savings advice\n\n" +
      "Example:\nAdd S$3 lunch"
    );

  // Add expense
  } else if (body.toLowerCase().startsWith("add")) {
    const match = body.match(/add\s*\$?(\d+(?:\.\d{1,2})?)\s*(.*)/i);
    if (match) {
      const amount = parseFloat(match[1]);
      const category = match[2] || "uncategorised";
      const all = readData();
      all.push({ category, amount, date: new Date().toISOString() });
      writeData(all);
      reply.body(`Okay lah! Added S$${amount.toFixed(2)} for ${category} ✅`);
    } else {
      reply.body("Say properly lah 😅 Example: Add S$4 coffee");
    }

  // Summary
  } else if (body.toLowerCase().includes("summary")) {
    const all = readData();
    if (all.length === 0) {
      reply.body("Aiyo, no record yet lah 😅 Try 'Add S$5 lunch' first!");
    } else {
      const totals = {};
      all.forEach(x => totals[x.category] = (totals[x.category] || 0) + x.amount);
      let text = "🧾 *Your Spending Summary This Week:*\n";
      for (let [cat, amt] of Object.entries(totals)) {
        text += `${cat}: S$${amt.toFixed(2)}\n`;
      }
      const total = Object.values(totals).reduce((a,b)=>a+b,0);
      text += `\n💰 *Total: S$${total.toFixed(2)}*\nKeep it up, don’t overspend ah 💪`;
      // 👇 Combine both summary and link (concatenated message)
      text += `\n\n📊 View full summary here 👉 https://auntie-bot.onrender.com/summary.html`;

      reply.body(text);
    }

  // Tips
  } else if (body.toLowerCase().includes("tip")) {
    const tips = [
      "💡 Don’t buy kopi every day lah, can save a lot one!",
      "💡 Use PayLah! cashback wisely, don’t spend more just to earn cents 😅",
      "💡 Cook at home sometimes, hawker food also add up one!",
      "💡 Before buy new gadget, ask yourself — really need or just want? 😉"
    ];
    reply.body(tips[Math.floor(Math.random() * tips.length)]);

  } else {
    reply.body("Hello dear 👋 Auntie here to help you track your money. Type *menu* to see options lah!");
  }

  res.type("text/xml").send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie Can Count One (SGD) running on ${PORT}`));
