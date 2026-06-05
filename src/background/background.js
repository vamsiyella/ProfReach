/**
 * ProfReach Background Service Worker
 * Handles: WebLLM model lifecycle, license validation, secure storage.
 *
 * IMPORTANT: This is a module worker (manifest "type": "module").
 * WebLLM is loaded via CDN ESM import — no bundler required for dev,
 * but you should bundle for production (Vite/Rollup recommended).
 */

// ─── WebLLM Import ────────────────────────────────────────────────────────
// In production, replace with local bundled import after: npm install @mlc-ai/web-llm
// import * as webllm from "@mlc-ai/web-llm";
// For development/testing, we use a dynamic CDN import:
//import * as webllm from "@mlc-ai/web-llm";

// ─── State ────────────────────────────────────────────────────────────────

const state = {
  engine: null,           // WebLLM MLCEngine instance
  modelLoaded: false,
  modelLoading: false,
  loadProgress: 0,
  licenseValid: false,
  licenseCheckedAt: null,
};

const MODEL_ID = "Phi-3-mini-4k-instruct-q4f16_1-MLC";
// Smallest high-quality option. Alternatives:
// "TinyLlama-1.1B-Chat-v0.4-q4f16_1-MLC"  (~600MB, faster, less quality)
// "Llama-3.2-1B-Instruct-q4f16_1-MLC"      (~1GB, good balance)
// "Phi-3-mini-4k-instruct-q4f16_1-MLC"     (~2GB, recommended)

// ─── License ──────────────────────────────────────────────────────────────

const LICENSE_ENDPOINT = "https://your-serverless-fn.vercel.app/api/validate";
// See /serverless/validate.js for the implementation

async function getDeviceFingerprint() {
  // Lightweight fingerprint: not cryptographically secure, just deters casual sharing
  const data = [
    navigator.userAgent,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen.colorDepth,
  ].join("|");

  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32); // 32-char hex prefix is enough
}

async function validateLicense(key) {
  const fingerprint = await getDeviceFingerprint();
  const resp = await fetch(LICENSE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, fingerprint }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json(); // { valid: bool, token: string, expiresAt: number }
}

async function checkStoredLicense() {

  //current block on checking for testing REMOVE LATER
    state.licenseValid = true;
    return true;


 /* const { licenseToken, licenseKey, licenseExpiresAt } = await chrome.storage.local.get([
    "licenseToken", "licenseKey", "licenseExpiresAt"
  ]);

  if (!licenseToken || !licenseKey) return false;

  // Token still valid locally
  if (licenseExpiresAt && Date.now() < licenseExpiresAt) {
    state.licenseValid = true;
    return true;
  }

  // Re-validate with server
  try {
    const result = await validateLicense(licenseKey);
    if (result.valid) {
      await chrome.storage.local.set({
        licenseToken: result.token,
        licenseExpiresAt: result.expiresAt,
      });
      state.licenseValid = true;
      return true;
    }
  } catch (e) {
    // Network failure — grant a grace period of 48h
    const gracePeriod = 48 * 60 * 60 * 1000;
    if (licenseExpiresAt && Date.now() < licenseExpiresAt + gracePeriod) {
      state.licenseValid = true;
      return true;
    }
  }

  state.licenseValid = false;
  return false; */
}

// ─── Model Loading ────────────────────────────────────────────────────────

/*async function initEngine(progressCallback) {
  if (state.engine && state.modelLoaded) return state.engine;
  if (state.modelLoading) return null;

  state.modelLoading = true;

  try {
    state.engine = new webllm.MLCEngine();

    await state.engine.reload(MODEL_ID, {
      initProgressCallback: (report) => {
        state.loadProgress = Math.round(report.progress * 100);
        progressCallback?.({
          progress: state.loadProgress,
          text: report.text,
        });
      },
    });

    state.modelLoaded = true;
    state.modelLoading = false;
    return state.engine;
  } catch (err) {
    state.modelLoading = false;
    throw err;
  }
} */

// ─── Email Generation ─────────────────────────────────────────────────────

function buildPrompt(studentProfile, professorData) {
  return `You are an expert at writing professional cold emails from high school students to professors.

Write a concise, sincere, and personalized cold email. The email should:
- Be 150-200 words maximum
- Have a compelling subject line
- Open with a specific reference to the professor's research (not generic flattery)
- Clearly state who the student is and their relevant experience
- Make a specific, actionable ask (informational interview, lab visit, reading a paper together, etc.)
- Sound like a thoughtful high schooler, not a corporate template
- Avoid buzzwords and clichés

FORMAT YOUR RESPONSE EXACTLY AS:
SUBJECT: [subject line here]

[email body here]

---

STUDENT PROFILE:
Name: ${studentProfile.name}
Grade: ${studentProfile.grade}
School: ${studentProfile.school}
Interests: ${studentProfile.interests}
Experience: ${studentProfile.experience}
Goal: ${studentProfile.goal || "explore research opportunities"}

PROFESSOR PROFILE:
Name: ${professorData.name}
Institution: ${professorData.institution}
Department: ${professorData.department}
Email: ${professorData.email}
Research: ${professorData.researchSummary?.slice(0, 500) || "Not available"}

Write the email now:`;
}

async function generateEmail(studentProfile, professorData, onChunk) {
  if (!state.licenseValid) {
    throw new Error("LICENSE_INVALID");
  }

  const engine = state.engine;
  if (!engine || !state.modelLoaded) {
    throw new Error("MODEL_NOT_LOADED");
  }

  const prompt = buildPrompt(studentProfile, professorData);

  const chunks = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    stream: true,
    temperature: 0.7,
    max_tokens: 400,
  });

  let fullText = "";
  for await (const chunk of chunks) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    fullText += delta;
    onChunk?.(delta, fullText);
  }

  return fullText;
}

// ─── Message Router ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {

    case "CHECK_LICENSE": {
      checkStoredLicense()
        .then((valid) => sendResponse({ valid }))
        .catch(() => sendResponse({ valid: false }));
      return true;
    }

    case "ACTIVATE_LICENSE": {
      const { key } = payload;
      validateLicense(key)
        .then(async (result) => {
          if (result.valid) {
            await chrome.storage.local.set({
              licenseKey: key,
              licenseToken: result.token,
              licenseExpiresAt: result.expiresAt,
            });
            state.licenseValid = true;
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, reason: result.reason || "Invalid key" });
          }
        })
        .catch((err) => sendResponse({ success: false, reason: err.message }));
      return true;
    }

    case "INIT_MODEL": {
      /* // Popup tells background to start loading the model
      initEngine((progress) => {
        // Broadcast progress to any open popup
        chrome.runtime.sendMessage({ type: "MODEL_PROGRESS", payload: progress })
          .catch(() => {}); // popup may be closed
      })
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; */

      sendResponse({ success: true });
      return true;

    }

    case "GET_MODEL_STATUS": {
      sendResponse({
        loaded: state.modelLoaded,
        loading: state.modelLoading,
        progress: state.loadProgress,
      });
      return true;
    }

    case "GENERATE_EMAIL": {

      sendResponse({ success: false, error: "USE_POPUP_ENGINE" });
      return true;  


      /* const { studentProfile, professorData } = payload;
      generateEmail(studentProfile, professorData, (delta, full) => {
        chrome.runtime.sendMessage({
          type: "EMAIL_CHUNK",
          payload: { delta, full },
        }).catch(() => {});
      })
        .then((email) => sendResponse({ success: true, email }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; */
    }

    default:
      break;
  }
});

// ─── Startup ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ProfReach] Extension installed.");
});

// Check license on startup so state is ready before popup opens
checkStoredLicense().catch(console.warn);
