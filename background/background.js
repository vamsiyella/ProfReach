/**
 * ProfReach Background Service Worker
 * Manages the offscreen document and routes all messages.
 */

// ─── Offscreen Document ───────────────────────────────────────────────────

let _creatingOffscreen = false;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length > 0) return true;
  if (_creatingOffscreen) return true;

  _creatingOffscreen = true;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "WebLLM AI model for email generation",
    });
    console.log("[ProfReach/bg] Offscreen document created.");
    return true;
  } catch (err) {
    if (err.message?.includes("single offscreen")) return true; // already exists, fine
    console.error("[ProfReach/bg] Offscreen error:", err.message);
    return false;
  } finally {
    _creatingOffscreen = false;
  }
}

function relay(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (r) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(r);
    });
  });
}

// ─── License ──────────────────────────────────────────────────────────────

async function checkLicense() {
  // TESTING MODE — always valid. Replace with real check before shipping.
  return true;
}

// ─── Gmail Draft ──────────────────────────────────────────────────────────

async function createGmailDraft({ to, subject, body }) {
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (t) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(t);
    });
  });

  const raw = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset=utf-8`, ``, body].join("\r\n");
  const encoded = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: encoded } }),
  });

  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error?.message || `HTTP ${resp.status}`);
  }
  return { success: true };
}

// ─── Message Router ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const { type, payload } = msg;

  if (type === "CHECK_LICENSE") {
    checkLicense().then(v => sendResponse({ valid: v })).catch(() => sendResponse({ valid: false }));
    return true;
  }

  if (type === "GET_MODEL_STATUS") {
    ensureOffscreen()
      .then(ok => ok ? relay("OFFSCREEN_STATUS") : { loaded: false, loading: false, progress: 0 })
      .then(s => sendResponse(s))
      .catch(() => sendResponse({ loaded: false, loading: false, progress: 0 }));
    return true;
  }

  if (type === "GENERATE_EMAIL") {
    ensureOffscreen()
      .then(ok => ok ? relay("OFFSCREEN_GENERATE", payload) : { success: false, error: "Offscreen unavailable" })
      .then(r => sendResponse(r))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (type === "GMAIL_DRAFT") {
    createGmailDraft(payload)
      .then(r => sendResponse(r))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ─── Startup ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ProfReach/bg] Installed.");
  ensureOffscreen();
});

ensureOffscreen(); // on every service worker wake — model starts loading immediately
