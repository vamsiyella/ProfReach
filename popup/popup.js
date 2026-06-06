/**
 * ProfReach Popup Controller
 * NO WebLLM import — model lives in the offscreen document.
 * Popup is lean and opens instantly after first load.
 */

"use strict";

// ─── Character limits ────────────────────────────────────────────────────
const LIMITS = { interests: 400, experience: 800, goal: 200, discovery: 300, researchSummary: 900 };

// ─── View Management ─────────────────────────────────────────────────────
const views = {
  loading: document.getElementById("view-loading"),
  license: document.getElementById("view-license"),
  main:    document.getElementById("view-main"),
};
function showView(name) {
  Object.entries(views).forEach(([k, el]) => el.classList.toggle("active", k === name));
}

// ─── Storage ─────────────────────────────────────────────────────────────
const getStorage = (keys) => new Promise(res => chrome.storage.local.get(keys, res));
const setStorage = (obj)  => new Promise(res => chrome.storage.local.set(obj, res));

// ─── Character Counters ──────────────────────────────────────────────────
function addCharCounter(id, max) {
  const el = document.getElementById(id);
  if (!el) return;
  const c = document.createElement("div");
  c.style.cssText = "font-size:10px;text-align:right;margin-top:3px;transition:color 0.15s;";
  const update = () => {
    if (el.value.length > max) el.value = el.value.slice(0, max);
    const n = el.value.length;
    c.textContent = `${n} / ${max}`;
    c.style.color = n >= max ? "#e06c75" : n >= max * 0.85 ? "#c9a84c" : "#5a6278";
  };
  el.addEventListener("input", update);
  el.parentElement.appendChild(c);
  update();
}

// ─── Profile ─────────────────────────────────────────────────────────────
const profileFields = {
  name: "student-name", grade: "student-grade", school: "student-school",
  interests: "student-interests", experience: "student-experience",
  goal: "student-goal", discovery: "student-discovery",
};

async function loadProfile() {
  const { studentProfile, attachResume } = await getStorage(["studentProfile", "attachResume"]);
  if (studentProfile) {
    Object.entries(profileFields).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el && studentProfile[key]) el.value = studentProfile[key];
    });
    ["student-interests","student-experience","student-goal","student-discovery"]
      .forEach(id => document.getElementById(id)?.dispatchEvent(new Event("input")));
  }
  if (attachResume) document.getElementById("attach-resume").checked = true;
}

function readProfile() {
  const p = {};
  Object.entries(profileFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) p[key] = el.value.trim();
  });
  p.attachResume = document.getElementById("attach-resume")?.checked || false;
  return p;
}

async function saveProfile() {
  const p = readProfile();
  await setStorage({ studentProfile: p, attachResume: p.attachResume });
  return p;
}

const profilePanel = document.getElementById("profile-panel");
document.getElementById("profile-toggle").addEventListener("click", () => profilePanel.classList.toggle("hidden"));
document.getElementById("profile-close").addEventListener("click",  () => profilePanel.classList.add("hidden"));
document.getElementById("save-profile-btn").addEventListener("click", async () => {
  await saveProfile();
  profilePanel.classList.add("hidden");
  showToast("Profile saved");
});

// ─── Professor Data ──────────────────────────────────────────────────────
const professorFields = {
  name: "prof-name", email: "prof-email",
  institution: "prof-institution", department: "prof-department",
  researchSummary: "prof-research",
};

function fillProfessorFields(data) {
  Object.entries(professorFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el && data[key]) el.value = data[key];
  });
  document.getElementById("prof-research")?.dispatchEvent(new Event("input"));
  document.getElementById("generate-btn").disabled = !data.name;
}

function readProfessorData() {
  const d = {};
  Object.entries(professorFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) d[key] = el.value.trim();
  });
  return d;
}

async function extractFromPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => {});
    return new Promise(resolve => {
      chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PROFESSOR_DATA" }, r => {
        resolve(chrome.runtime.lastError || !r?.success ? null : r.data);
      });
    });
  } catch { return null; }
}

document.getElementById("re-extract-btn").addEventListener("click", async () => {
  const btn = document.getElementById("re-extract-btn");
  btn.textContent = "Extracting…"; btn.disabled = true;
  const data = await extractFromPage();
  if (data) { fillProfessorFields(data); showToast("Page re-extracted"); }
  else { showToast("Could not read page — fill in manually", true); }
  btn.textContent = "↺ Re-extract"; btn.disabled = false;
});

// ─── Model Status ────────────────────────────────────────────────────────
const modelBar   = document.getElementById("model-bar");
const modelFill  = document.getElementById("model-progress-fill");
const modelText  = document.getElementById("model-status-text");
const statusBadge = document.getElementById("model-status-badge");

function setModelReady() {
  modelBar.classList.add("hidden");
  statusBadge.textContent = "● Ready";
  statusBadge.className = "status-badge ready";
}

async function initModel() {
  const status = await chrome.runtime.sendMessage({ type: "GET_MODEL_STATUS" });
  if (status?.loaded) { setModelReady(); return; }

  modelBar.classList.remove("hidden");
  if (status?.progress > 0) {
    modelFill.style.width = `${status.progress}%`;
    modelText.textContent = `Loading AI model… ${status.progress}%`;
  }

  // Poll every 2 seconds
  const poll = setInterval(async () => {
    const s = await chrome.runtime.sendMessage({ type: "GET_MODEL_STATUS" }).catch(() => null);
    if (!s) return;
    if (s.progress > 0) {
      modelFill.style.width = `${s.progress}%`;
      modelText.textContent = `Loading AI model… ${s.progress}%`;
    }
    if (s.loaded) { clearInterval(poll); setModelReady(); }
  }, 2000);
}

// Real-time progress from offscreen broadcasts
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "MODEL_PROGRESS") {
    const { progress, text } = msg.payload;
    modelBar.classList.remove("hidden");
    modelFill.style.width = `${progress}%`;
    modelText.textContent = text || `Loading AI model… ${progress}%`;
    if (progress >= 100) setTimeout(setModelReady, 800);
  }
  if (msg.type === "EMAIL_CHUNK") {
    renderEmailChunk(msg.payload.full);
  }
});

// ─── Prompt Builder ──────────────────────────────────────────────────────
function buildPrompt(student, prof) {
  const experience = (student.experience || "").slice(0, LIMITS.experience);
  const interests  = (student.interests  || "").slice(0, LIMITS.interests);
  const goal       = (student.goal       || "a 15-minute call").slice(0, LIMITS.goal);
  const discovery  = (student.discovery  || "").slice(0, LIMITS.discovery);
  const research   = (prof.researchSummary || "").slice(0, LIMITS.researchSummary);

  return `Write a cold email from a high school student to a professor. Write it AS the student, in first person. It must sound exactly like a real student wrote it — NOT an AI, NOT a template.

TONE: Formal but genuine. Smart and driven. Confident, not corporate.

BANNED PHRASES — never use these:
"I hope this email finds you well", "I am reaching out", "I wanted to touch base",
"leverage", "synergy", "impactful", "passionate about making a difference",
"I am writing to", "I recently came across", "I would like to express my interest"

CRITICAL — NO HALLUCINATION:
- Use ONLY the information explicitly provided in the profile below
- Do NOT invent clubs, awards, competitions, statistics, percentages, or projects not listed
- If a profile field is empty, omit that aspect — do not fill it in
- Better to write a shorter accurate email than a longer fabricated one
- If you don't have enough information for a specific claim, write around it

STRUCTURE (follow exactly):
1. SUBJECT: Specific, attention-grabbing. Include a time hook if it flows naturally.
2. SALUTATION: "Dear Professor [LastName],"
3. OPENING (1-2 sentences): Acknowledge their time. Example: "I know you are incredibly busy, so I will keep this brief."
4. HOW I FOUND YOU + CONNECTION (2-3 sentences): Student's name, school, grade, and a genuine story of how their specific research connected to something the student was ALREADY doing. Use details from the research summary. Be specific — reference an actual technique, problem, or topic from their work.
5. CREDIBILITY (2-3 sentences): The student's ACTUAL accomplishments from the profile below, with specific details. Lead with what is most relevant to this professor's field. Do not invent anything.
6. THE ASK (1-2 sentences): A modest, specific request. Make it easy to say yes.
7. SIGN-OFF: Warm and brief. Student's name only.

LENGTH: 150-200 words. No filler.

FORMAT:
SUBJECT: [subject line]

[email body]

STUDENT PROFILE:
Name: ${student.name || "the student"}
Grade: ${student.grade || "11th grade"}, ${student.school || "high school"}
Research Interests: ${interests || "(not provided — omit this aspect)"}
Experience: ${experience || "(not provided — write around this)"}
How they found this professor: ${discovery || "(not specified — infer naturally from research)"}
Ask: ${goal}

PROFESSOR PROFILE:
Name: ${prof.name || "Professor"}
Institution: ${prof.institution || ""}
Department: ${prof.department || ""}
Research: ${research || "(not provided)"}

Write the email now:`;
}

// ─── Email Generation ─────────────────────────────────────────────────────
let currentEmailData = { subject: "", body: "" };

function parseEmailText(raw) {
  const lines = raw.split("\n");
  let subject = "", bodyStart = 0;
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const m = lines[i].match(/^\s*subject[:\s]+(.+)/i);
    if (m) { subject = m[1].trim(); bodyStart = i + 1; break; }
  }
  while (bodyStart < lines.length && !lines[bodyStart].trim()) bodyStart++;
  return { subject, body: lines.slice(bodyStart).join("\n").trim() };
}

function renderEmailChunk(fullText) {
  const { subject, body } = parseEmailText(fullText);
  document.getElementById("email-subject").textContent = subject || "";
  document.getElementById("email-body").textContent = body || fullText;
  currentEmailData = { subject, body };
}

function setGenerating(on) {
  const output     = document.getElementById("email-output");
  const placeholder = document.getElementById("email-placeholder");
  const generating  = document.getElementById("email-generating");
  placeholder.classList.toggle("hidden", on || output.dataset.hasContent === "true");
  generating.classList.toggle("hidden", !on);
  output.classList.toggle("hidden", on);
}

async function doGenerate(followUp = false) {
  const profile  = readProfile();
  const profData = readProfessorData();

  if (!profile.name || !profile.school) {
    profilePanel.classList.remove("hidden");
    showToast("Fill in your profile first (⚙)", true);
    return;
  }
  if (!profData.name) { showToast("Professor name is required", true); return; }

  // Check model status
  const status = await chrome.runtime.sendMessage({ type: "GET_MODEL_STATUS" }).catch(() => null);
  if (!status?.loaded) { showToast("AI model still loading — try again in a moment", true); return; }

  const genBtn  = document.getElementById("generate-btn");
  const regenBtn = document.getElementById("regenerate-btn");
  genBtn.disabled = true;
  if (regenBtn) regenBtn.disabled = true;
  setGenerating(true);
  document.getElementById("generating-text").textContent = followUp ? "Writing follow-up…" : "Writing your email…";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_EMAIL",
      payload: { prompt: buildPrompt(profile, profData) },
    });

    setGenerating(false);

    if (response?.success) {
      renderEmailChunk(response.email);

      // Append resume line if requested
      if (profile.attachResume) {
        const body = document.getElementById("email-body");
        const resumeLine = "\n\nI have attached my resume for your reference and would love to schedule a brief 15-minute call to discuss how I might contribute to your research.";
        body.textContent += resumeLine;
        currentEmailData.body += resumeLine;
      }

      const output = document.getElementById("email-output");
      output.dataset.hasContent = "true";
      output.classList.remove("hidden");
      document.getElementById("email-placeholder").classList.add("hidden");
    } else {
      showToast("Generation failed: " + (response?.error || "unknown error"), true);
    }
  } catch (err) {
    setGenerating(false);
    showToast("Error: " + err.message, true);
  } finally {
    genBtn.disabled = false;
    if (regenBtn) regenBtn.disabled = false;
  }
}

document.getElementById("generate-btn").addEventListener("click",   () => doGenerate());
document.getElementById("regenerate-btn").addEventListener("click", () => doGenerate());
document.getElementById("followup-btn").addEventListener("click",   () => doGenerate(true));

// ─── Email Actions ────────────────────────────────────────────────────────
document.getElementById("copy-btn").addEventListener("click", async () => {
  const { subject, body } = currentEmailData;
  const text = subject ? `Subject: ${subject}\n\n${body}` : body;
  await navigator.clipboard.writeText(text);
  showToast("Copied to clipboard ✓");
});

document.getElementById("gmail-btn").addEventListener("click", () => {
  const prof = readProfessorData();
  const { subject, body } = currentEmailData;
  const p = new URLSearchParams({ to: prof.email || "", su: subject || "", body: body || "" });
  chrome.tabs.create({ url: `https://mail.google.com/mail/?view=cm&fs=1&${p}` });
});

document.getElementById("draft-btn").addEventListener("click", async () => {
  const prof = readProfessorData();
  const { subject, body } = currentEmailData;
  if (!body) { showToast("Generate an email first", true); return; }

  const btn = document.getElementById("draft-btn");
  btn.textContent = "Saving…"; btn.disabled = true;

  const resp = await chrome.runtime.sendMessage({
    type: "GMAIL_DRAFT",
    payload: { to: prof.email || "", subject: subject || "", body },
  });

  btn.textContent = "Save as Draft"; btn.disabled = false;

  if (resp?.success) showToast("Draft saved to Gmail ✓");
  else showToast("Draft failed: " + (resp?.error || "check Gmail setup"), true);
});

// ─── License ─────────────────────────────────────────────────────────────
document.getElementById("activate-btn").addEventListener("click", async () => {
  const key     = document.getElementById("license-input").value.trim();
  const errorEl = document.getElementById("license-error");
  const btn     = document.getElementById("activate-btn");
  if (!key) { errorEl.textContent = "Please enter a license key."; errorEl.classList.remove("hidden"); return; }
  btn.textContent = "Validating…"; btn.disabled = true; errorEl.classList.add("hidden");
  const r = await chrome.runtime.sendMessage({ type: "ACTIVATE_LICENSE", payload: { key } });
  btn.textContent = "Activate"; btn.disabled = false;
  if (r?.success) { showView("main"); await initMain(); }
  else { errorEl.textContent = r?.reason || "Invalid key."; errorEl.classList.remove("hidden"); }
});

// ─── Toast ────────────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, isError = false) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div"); t.id = "toast";
    t.style.cssText = "position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#1e2436;border:1px solid #2a3148;border-radius:6px;padding:7px 16px;font-size:12px;color:#e8e6df;box-shadow:0 4px 16px rgba(0,0,0,0.4);z-index:9999;transition:opacity 0.2s;pointer-events:none;";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.borderColor = isError ? "#e06c75" : "#2a3148";
  t.style.opacity = "1";
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.style.opacity = "0"; }, 3000);
}

// ─── Init ─────────────────────────────────────────────────────────────────
async function initMain() {
  // Attach counters
  addCharCounter("student-interests",  LIMITS.interests);
  addCharCounter("student-experience", LIMITS.experience);
  addCharCounter("student-goal",       LIMITS.goal);
  addCharCounter("student-discovery",  LIMITS.discovery);
  addCharCounter("prof-research",      LIMITS.researchSummary);

  await loadProfile();
  const profData = await extractFromPage();
  if (profData) fillProfessorFields(profData);

  // Enable generate if name present
  document.getElementById("prof-name")?.addEventListener("input", () => {
    document.getElementById("generate-btn").disabled = !document.getElementById("prof-name").value.trim();
  });

  initModel();
}

async function init() {
  showView("loading");
  const r = await chrome.runtime.sendMessage({ type: "CHECK_LICENSE" });
  if (r?.valid) { showView("main"); await initMain(); }
  else { showView("license"); }
}

init().catch(console.error);
