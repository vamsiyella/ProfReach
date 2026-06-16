/**
 * ProfReach — /api/generate.js
 * Calls Groq API with the prompt from the extension.
 * The Groq API key lives here on the server — never exposed to users.
 *
 * Environment variables (set in Vercel dashboard):
 *   GROQ_API_KEY   — from console.groq.com (free tier)
 *   ALLOWED_ORIGIN — your extension ID, e.g. chrome-extension://abcdef123...
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL        = "llama-3.1-70b-versatile"; // free, fast, high quality
// Alternatives: "llama-3.1-8b-instant" (faster), "mixtral-8x7b-32768" (good balance)

module.exports = async function handler(req, res) {
  // CORS — only allow requests from your Chrome extension
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin.startsWith("chrome-extension://") ? origin : "");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "API key not configured" });

  try {
    const groqResp = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        model:       MODEL,
        max_tokens:  500,
        temperature: 0.75,
        messages: [
          {
            role: "system",
            content: "You are a writing assistant that generates personalized cold emails for high school students reaching out to professors. You follow instructions precisely and never hallucinate information not provided.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!groqResp.ok) {
      const err = await groqResp.json().catch(() => ({}));
      console.error("[ProfReach/generate] Groq error:", err);
      return res.status(502).json({ error: err.error?.message || `Groq error ${groqResp.status}` });
    }

    const data  = await groqResp.json();
    const email = data.choices?.[0]?.message?.content?.trim() || "";

    if (!email) return res.status(502).json({ error: "Empty response from AI" });

    return res.status(200).json({ email });

  } catch (err) {
    console.error("[ProfReach/generate] Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
