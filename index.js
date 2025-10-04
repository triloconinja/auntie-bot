const express = require("express");
const bodyParser = require("body-parser");
const { MessagingResponse } = require("twilio").twiml;

const app = express();
app.use(express.static('public'));  // ✅ serve public files like summary.html
app.use(bodyParser.urlencoded({ extended: false }));

app.post("/whatsapp", (req, res) => {
  const body = (req.body.Body || "").trim().toLowerCase();
  const twiml = new MessagingResponse();
  const reply = twiml.message();

  if (body === "help") {
    reply.body(
      "👵 Auntie Can Count One here!\n" +
      "Try these:\n" +
      "• 5 kopi\n" +
      "• spent 12 lunch\n" +
      "• summary\n" +
      "• help\n"
    );
  } else if (/^\$?\d+/.test(body) || body.startsWith("spent")) {
    reply.body("Wah noted ah! Auntie record liao 💪 (later I send summary)");
  } else if (body.includes("summary")) {
    reply.body("Here’s your weekly summary lah 👉 https://auntie-bot.onrender.com/summary.html");
  } else {
    reply.body("Hello hello! Type *help* to see what Auntie can do. Can count one lah! 🤗");
  }

  res.type("text/xml").send(twiml.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie bot running on ${PORT}`));
