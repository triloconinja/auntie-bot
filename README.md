# Auntie Can Count One 👵 WhatsApp Bot

Simple Twilio WhatsApp Sandbox bot built with Node.js + Express.

## How to run locally
1. Install Node.js 18+
2. Run:
   ```bash
   npm install
   npm start
   ```
3. Expose port 3000 using [ngrok](https://ngrok.com):
   ```bash
   ngrok http 3000
   ```
4. Copy the HTTPS URL from ngrok and paste it in Twilio Sandbox:
   **Messaging → Try it out → WhatsApp Sandbox → When a message comes in**

## Deploy on Render
1. Push this folder to GitHub
2. Go to https://render.com → New Web Service → select repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Use the deployed URL + `/whatsapp` in your Twilio Sandbox webhook.

## Test
On WhatsApp (after joining the Twilio Sandbox number), send:
- `help`
- `5 kopi`
- `summary`

Auntie will reply automatically 💬
