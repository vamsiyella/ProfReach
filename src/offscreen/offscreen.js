/**
 * ProfReach Offscreen Document
 * Persists while browser is open. Model loads ONCE at browser start,
 * never reloads just because the popup closed.
 */
import * as webllm from "@mlc-ai/web-llm";

const MODEL_ID = "Phi-3-mini-4k-instruct-q4f16_1-MLC";

let engine   = null;
let loaded   = false;
let loading  = false;
let progress = 0;

async function initEngine() {
  if (loaded && engine) return engine;
  if (loading) return null;
  loading = true;
  console.log("[ProfReach/offscreen] Loading:", MODEL_ID);

  try {
    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (r) => {
        progress = Math.round(r.progress * 100);
        chrome.runtime.sendMessage({
          type: "MODEL_PROGRESS",
          payload: { progress, text: r.text },
        }).catch(() => {});
      },
    });
    loaded   = true;
    loading  = false;
    progress = 100;
    console.log("[ProfReach/offscreen] Ready!");
    return engine;
  } catch (err) {
    loading = false;
    console.error("[ProfReach/offscreen] Load error:", err);
    throw err;
  }
}

// Start loading the moment Chrome creates this document
initEngine().catch(console.error);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "OFFSCREEN_STATUS") {
    sendResponse({ loaded, loading, progress });
    return true;
  }

  if (msg.type === "OFFSCREEN_GENERATE") {
    if (!loaded || !engine) {
      sendResponse({ success: false, error: "MODEL_NOT_LOADED" });
      return true;
    }
    (async () => {
      try {
        let full = "";
        const chunks = await engine.chat.completions.create({
          messages: [{ role: "user", content: msg.payload.prompt }],
          stream: true,
          temperature: 0.75,
          max_tokens: 280,
        });
        for await (const chunk of chunks) {
          full += chunk.choices[0]?.delta?.content ?? "";
          chrome.runtime.sendMessage({ type: "EMAIL_CHUNK", payload: { full } }).catch(() => {});
        }
        sendResponse({ success: true, email: full });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});
