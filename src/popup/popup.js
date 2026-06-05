/**
 * ProfReach Popup Controller
 * Manages views, profile storage, professor data, and email generation flow.
 */

"use strict";



import * as webllm from "@mlc-ai/web-llm";

const engineState = {
  engine: null,
  loaded: false,
  loading: false,
};

async function getEngine(onProgress) {
  if (engineState.engine && engineState.loaded) return engineState.engine;
  if (engineState.loading) return null;

  engineState.loading = true;
  engineState.engine = new webllm.MLCEngine();

  await engineState.engine.reload("Phi-3-mini-4k-instruct-q4f16_1-MLC", {
    initProgressCallback: (report) => {
      const pct = Math.round(report.progress * 100);
      onProgress?.(pct, report.text);
    },
  });

  engineState.loaded = true;
  engineState.loading = false;
  return engineState.engine;
}

// ─── View Management ──────────────────────────────────────────────────────

const views = {
  loading: document.getElementById("view-loading"),
  license: document.getElementById("view-license"),
  main: document.getElementById("view-main"),
};

function showView(name) {
  Object.entries(views).forEach(([k, el]) => {
    el.classList.toggle("active", k === name);
  });
}

// ─── Tab Management ───────────────────────────────────────────────────────

const tabs = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");

function switchTab(tabName) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  tabContents.forEach((c) =>
    c.classList.toggle("active", c.id === `tab-${tabName}`)
  );
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

// ─── Storage Helpers ──────────────────────────────────────────────────────

async function getStorage(keys) {
  return new Promise((res) => chrome.storage.local.get(keys, res));
}

async function setStorage(obj) {
  return new Promise((res) => chrome.storage.local.set(obj, res));
}

// ─── Profile ──────────────────────────────────────────────────────────────

const profileFields = {
  name: "student-name",
  grade: "student-grade",
  school: "student-school",
  interests: "student-interests",
  experience: "student-experience",
  goal: "student-goal",
};

async function loadProfile() {
  const { studentProfile } = await getStorage("studentProfile");
  if (!studentProfile) return;
  Object.entries(profileFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el && studentProfile[key]) el.value = studentProfile[key];
  });
}

function readProfile() {
  const profile = {};
  Object.entries(profileFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) profile[key] = el.value.trim();
  });
  return profile;
}

async function saveProfile() {
  const profile = readProfile();
  await setStorage({ studentProfile: profile });
  return profile;
}

// Profile panel toggle
const profilePanel = document.getElementById("profile-panel");

document.getElementById("profile-toggle").addEventListener("click", () => {
  profilePanel.classList.toggle("hidden");
});

document.getElementById("profile-close").addEventListener("click", () => {
  profilePanel.classList.add("hidden");
});

document.getElementById("save-profile-btn").addEventListener("click", async () => {
  await saveProfile();
  profilePanel.classList.add("hidden");
  showToast("Profile saved");
});

// ─── Professor Data ───────────────────────────────────────────────────────

const professorFields = {
  name: "prof-name",
  email: "prof-email",
  institution: "prof-institution",
  department: "prof-department",
  researchSummary: "prof-research",
};

function fillProfessorFields(data) {
  Object.entries(professorFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el && data[key]) el.value = data[key];
  });
  // Enable generate button if we at least have a name
  document.getElementById("generate-btn").disabled = !data.name;
}

function readProfessorData() {
  const data = {};
  Object.entries(professorFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) data[key] = el.value.trim();
  });
  return data;
}

async function extractFromPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;

  try {
    // Ensure content script is injected (handles edge cases)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).catch(() => {}); // may already be injected

    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tab.id,
        { type: "EXTRACT_PROFESSOR_DATA" },
        (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            resolve(null);
          } else {
            resolve(response.data);
          }
        }
      );
    });
  } catch {
    return null;
  }
}

document.getElementById("re-extract-btn").addEventListener("click", async () => {
  const btn = document.getElementById("re-extract-btn");
  btn.textContent = "Extracting…";
  btn.disabled = true;

  const data = await extractFromPage();
  if (data) {
    fillProfessorFields(data);
    showToast("Page re-extracted");
  } else {
    showToast("Could not read page — fill in manually", true);
  }

  btn.textContent = "↺ Re-extract";
  btn.disabled = false;
});

// ─── Model Status ─────────────────────────────────────────────────────────

const modelBar = document.getElementById("model-bar");
const modelFill = document.getElementById("model-progress-fill");
const modelText = document.getElementById("model-status-text");

async function initModel() {
  modelBar.classList.remove("hidden");
  modelText.textContent = "Loading AI model…";

  getEngine((pct, text) => {
    modelFill.style.width = `${pct}%`;
    modelText.textContent = text || `Loading AI model… ${pct}%`;
    if (pct >= 100) {
      setTimeout(() => modelBar.classList.add("hidden"), 800);
    }
  }).catch((err) => {
    modelText.textContent = "Model failed to load: " + err.message;
    console.error(err);
  });
}

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "MODEL_PROGRESS") {
    const { progress, text } = message.payload;
    modelFill.style.width = `${progress}%`;
    modelText.textContent = text || `Loading AI model… ${progress}%`;

    if (progress >= 100) {
      setTimeout(() => modelBar.classList.add("hidden"), 800);
    }
  }

  if (message.type === "EMAIL_CHUNK") {
    const { full } = message.payload;
    renderEmailChunk(full);
  }
});

// ─── Email Generation ─────────────────────────────────────────────────────

let currentEmailData = { subject: "", body: "" };

function parseEmailText(rawText) {
  const subjectMatch = rawText.match(/^SUBJECT:\s*(.+)/im);
  const subject = subjectMatch ? subjectMatch[1].trim() : "";

  let body = rawText
    .replace(/^SUBJECT:\s*.+/im, "")
    .trim();

  return { subject, body };
}

function renderEmailChunk(fullText) {
  const { subject, body } = parseEmailText(fullText);
  document.getElementById("email-subject").textContent = subject || "";
  document.getElementById("email-body").textContent = body || fullText;
  currentEmailData = { subject, body };
}

function setEmailGenerating(isGenerating) {
  const placeholder = document.getElementById("email-placeholder");
  const output = document.getElementById("email-output");
  const generating = document.getElementById("email-generating");

  placeholder.classList.toggle("hidden", isGenerating || output.dataset.hasContent === "true");
  generating.classList.toggle("hidden", !isGenerating);
  output.classList.toggle("hidden", isGenerating);

  if (isGenerating) {
    switchTab("email");
  }
}

async function doGenerate(followUp = false) {
  const profile = readProfile();
  const profData = readProfessorData();

  if (!profile.name || !profile.school) {
    profilePanel.classList.remove("hidden");
    showToast("Fill in your profile first", true);
    return;
  }

  if (!profData.name) {
    showToast("Professor name is required", true);
    return;
  }

  const generateBtn = document.getElementById("generate-btn");
  const regenerateBtn = document.getElementById("regenerate-btn");
  generateBtn.disabled = true;
  if (regenerateBtn) regenerateBtn.disabled = true;

  setEmailGenerating(true);

  document.getElementById("generating-text").textContent = followUp
    ? "Writing a follow-up email…"
    : "Writing your email…";

  if (followUp && currentEmailData.body) {
    // Append follow-up context to the professor data
    profData._followUp = true;
    profData._originalEmail = currentEmailData.body;
  }

  try {
    const engine = engineState.engine;
    if (!engine || !engineState.loaded) {
      showToast("AI model still loading — try again in a moment", true);
      setEmailGenerating(false);
      generateBtn.disabled = false;
      if (regenerateBtn) regenerateBtn.disabled = false;
      return;
    }

    const prompt = buildPrompt(profile, profData);
    let fullText = "";

    const chunks = await engine.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 400,
    });

    for await (const chunk of chunks) {
      fullText += chunk.choices[0]?.delta?.content ?? "";
      renderEmailChunk(fullText);
    }

    setEmailGenerating(false);
    renderEmailChunk(fullText);
    document.getElementById("email-output").dataset.hasContent = "true";
    document.getElementById("email-output").classList.remove("hidden");
    document.getElementById("email-placeholder").classList.add("hidden");
    generateBtn.disabled = false;
    if (regenerateBtn) regenerateBtn.disabled = false;

    setEmailGenerating(false);

    if (response.success) {
      const parsed = parseEmailText(response.email);
      renderEmailChunk(response.email);
      document.getElementById("email-output").dataset.hasContent = "true";
      document.getElementById("email-output").classList.remove("hidden");
      document.getElementById("email-placeholder").classList.add("hidden");
    } else {
      if (response.error === "LICENSE_INVALID") {
        showView("license");
      } else if (response.error === "MODEL_NOT_LOADED") {
        showToast("AI model still loading — try again in a moment", true);
      } else {
        showToast("Generation failed: " + response.error, true);
      }
    }
  } catch (err) {
    setEmailGenerating(false);
    showToast("Error: " + err.message, true);
  } finally {
    generateBtn.disabled = false;
    if (regenerateBtn) regenerateBtn.disabled = false;
  }
}

document.getElementById("generate-btn").addEventListener("click", () => doGenerate());
document.getElementById("regenerate-btn").addEventListener("click", () => doGenerate());
document.getElementById("followup-btn").addEventListener("click", () => doGenerate(true));

// ─── Email Actions ────────────────────────────────────────────────────────

document.getElementById("copy-btn").addEventListener("click", async () => {
  const { subject, body } = currentEmailData;
  const text = subject ? `Subject: ${subject}\n\n${body}` : body;
  await navigator.clipboard.writeText(text);
  showToast("Copied to clipboard");
});

document.getElementById("gmail-btn").addEventListener("click", () => {
  const profData = readProfessorData();
  const { subject, body } = currentEmailData;

  const params = new URLSearchParams({
    to: profData.email || "",
    su: subject || "",
    body: body || "",
  });

  chrome.tabs.create({
    url: `https://mail.google.com/mail/?view=cm&fs=1&${params.toString()}`,
  });
});

// ─── License Flow ─────────────────────────────────────────────────────────

document.getElementById("activate-btn").addEventListener("click", async () => {
  const key = document.getElementById("license-input").value.trim();
  const errorEl = document.getElementById("license-error");
  const btn = document.getElementById("activate-btn");

  if (!key) {
    errorEl.textContent = "Please enter a license key.";
    errorEl.classList.remove("hidden");
    return;
  }

  btn.textContent = "Validating…";
  btn.disabled = true;
  errorEl.classList.add("hidden");

  const response = await chrome.runtime.sendMessage({
    type: "ACTIVATE_LICENSE",
    payload: { key },
  });

  btn.textContent = "Activate";
  btn.disabled = false;

  if (response.success) {
    showView("main");
    await initMain();
  } else {
    errorEl.textContent = response.reason || "Invalid license key. Please try again.";
    errorEl.classList.remove("hidden");
  }
});

// ─── Toast Notifications ──────────────────────────────────────────────────

let toastTimeout;
function showToast(message, isError = false) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.style.cssText = `
      position:fixed; bottom:12px; left:50%; transform:translateX(-50%);
      background:#1e2436; border:1px solid #2a3148; border-radius:6px;
      padding:7px 14px; font-size:12px; color:#e8e6df;
      box-shadow:0 4px 16px rgba(0,0,0,0.4); z-index:9999;
      transition:opacity 0.2s;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.borderColor = isError ? "#e06c75" : "#2a3148";
  toast.style.opacity = "1";

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.opacity = "0";
  }, 2500);
}

// ─── Initialization ───────────────────────────────────────────────────────

async function initMain() {
  // Load saved profile
  await loadProfile();

  // Extract professor data from active tab
  const profData = await extractFromPage();
  if (profData) {
    fillProfessorFields(profData);
  }

  // Kick off model loading (background handles it)
  await initModel();
}

async function init() {
  showView("loading");

  const response = await chrome.runtime.sendMessage({ type: "CHECK_LICENSE" });

  if (response.valid) {
    showView("main");
    await initMain();
  } else {
    showView("license");
  }
}

// Input-triggered generate button state
["prof-name", "prof-email"].forEach((id) => {
  document.getElementById(id)?.addEventListener("input", () => {
    const name = document.getElementById("prof-name")?.value.trim();
    document.getElementById("generate-btn").disabled = !name;
  });
});

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


init().catch(console.error);
