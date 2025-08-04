const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
  OPENAI_API_KEY,
  INSTAGRAM_PAGE_ACCESS_TOKEN,
  VERIFY_TOKEN,
  IG_USERNAME,
} = process.env;

// ⏱ Track replied threads
const repliedThreads = new Set(); // Set of parent comment IDs

// ✅ Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 📦 Webhook handler
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body?.object === "instagram") {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "comments") {
          const value = change.value;
          const commentText = value.text;
          const commentId = value.id;
          const parentId = value.parent_id || value.id;
          const username = value.from?.username;

          console.log("💬 Comment:", commentText);
          console.log("👤 From:", username);
          console.log("🧵 Thread ID:", parentId);

          // ⛔ Skip if comment is from our account
          if (username === IG_USERNAME) {
            console.log("⛔ Skipping: Comment from own account.");
            continue;
          }

          // ⛔ Skip if already replied to this thread
          if (repliedThreads.has(parentId)) {
            console.log("⛔ Skipping: Already replied in this thread.");
            continue;
          }

          // ⛔ Skip if asking for a link
          if (isAskingForLink(commentText)) {
            console.log("⛔ Skipping: Comment asking for link.");
            continue;
          }

          // ✅ Generate and send reply
          const reply = await generateReply(commentText, username);
          if (reply) {
            await replyToComment(commentId, reply);
            repliedThreads.add(parentId);
          }
        }
      }
    }
    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.sendStatus(404);
});

// 🔍 Check for link-related keywords
function isAskingForLink(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("link") ||
    lower.includes("buy") ||
    lower.includes("website") ||
    lower.includes("url") ||
    lower.includes("how to buy") ||
    lower.includes("where can i get") ||
    (lower.includes("send") && lower.includes("link"))
  );
}

// 🧠 Generate reply from OpenAI
async function generateReply(comment, username) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "o4-mini-2025-04-16",
        messages: [
          {
            role: "system",
            content: `At Reginald Men, we are committed to providing friendly, clear, and helpful replies to Instagram comments. 
If the comment expresses negative sentiment (e.g., complaint, disappointment, poor experience), always reply:
"For better assistance, please DM us your Order ID, phone number, and issue in detail — we’ll help you right away.`,
          },
          {
            role: "user",
            content: `Instagram user ${`@` + username} commented: "${comment}"`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY.trim()}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error(
      "❌ Error generating reply:",
      error.response?.data || error.message
    );
    return null;
  }
}

// 💬 Reply to Instagram comment
async function replyToComment(commentId, message) {
  if (!message) return;
  try {
    const url = `https://graph.facebook.com/v19.0/${commentId}/replies`;
    const res = await axios.post(url, {
      message,
      access_token: INSTAGRAM_PAGE_ACCESS_TOKEN,
    });
    console.log("✅ Replied to comment:", res.data);
  } catch (error) {
    console.error(
      "❌ Error replying to comment:",
      error.response?.data || error.message
    );
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
