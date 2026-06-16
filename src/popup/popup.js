/**
 * ProfReach Popup Controller
 * Uses server-side AI (Groq via Vercel) for generation.
 * History stored in chrome.storage.local.
 */

"use strict";

// ─── Config ──────────────────────────────────────────────────────────────
// Point this at your Vercel function once deployed
const API_BASE = "https://your-vercel-app.vercel.app/api";

// Character limits to keep prompts reasonable
const LIMITS = { interests: 400, experience: 800, goal: 200, discovery: 300, researchSummary: 900 };

// Max history entries stored locally
const MAX_HISTORY = 50;

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
  c.style.cssText = "font-size:10px;text-align:right;margin-top:2px;transition:color 0.15s;";
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
document.getElementById("profile-toggle").addEventListener("click", () => {
  historyPanel.classList.add("hidden");
  profilePanel.classList.toggle("hidden");
});
document.getElementById("profile-close").addEventListener("click", () => profilePanel.classList.add("hidden"));
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
  btn.textContent = "Reading…"; btn.disabled = true;
  const data = await extractFromPage();
  if (data) { fillProfessorFields(data); showToast("Page re-extracted"); }
  else { showToast("Could not read page — fill in manually", true); }
  btn.textContent = "↺ Re-extract"; btn.disabled = false;
});

// ─── Model Status (for local fallback) ───────────────────────────────────
const modelBar    = document.getElementById("model-bar");
const modelFill   = document.getElementById("model-progress-fill");
const modelText   = document.getElementById("model-status-text");
const statusBadge = document.getElementById("model-status-badge");

function setModelReady() {
  modelBar.classList.add("hidden");
  statusBadge.textContent = "● Ready";
  statusBadge.className = "status-badge ready";
}

async function initModel() {
  // When using server-side AI, we just check connectivity
  try {
    const resp = await fetch(`${API_BASE}/health`).catch(() => null);
    if (resp?.ok) {
      setModelReady();
      return;
    }
  } catch {}

  // Fall back to checking local offscreen model
  const status = await chrome.runtime.sendMessage({ type: "GET_MODEL_STATUS" }).catch(() => null);
  if (status?.loaded) { setModelReady(); return; }

  if (status?.loading || status?.progress > 0) {
    modelBar.classList.remove("hidden");
    if (status?.progress > 0) {
      modelFill.style.width = `${status.progress}%`;
      modelText.textContent = `Loading AI model… ${status.progress}%`;
    }
    const poll = setInterval(async () => {
      const s = await chrome.runtime.sendMessage({ type: "GET_MODEL_STATUS" }).catch(() => null);
      if (!s) return;
      if (s.progress > 0) {
        modelFill.style.width = `${s.progress}%`;
        modelText.textContent = `Loading AI model… ${s.progress}%`;
      }
      if (s.loaded) { clearInterval(poll); setModelReady(); }
    }, 2000);
  } else {
    // Server mode — just show ready
    setModelReady();
  }
}

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
function buildPrompt(student, prof, isFollowUp = false, originalEmail = "") {
  const experience = (student.experience || "").slice(0, LIMITS.experience);
  const interests  = (student.interests  || "").slice(0, LIMITS.interests);
  const goal       = (student.goal       || "a 15-minute call").slice(0, LIMITS.goal);
  const discovery  = (student.discovery  || "").slice(0, LIMITS.discovery);
  const research   = (prof.researchSummary || "").slice(0, LIMITS.researchSummary);

  if (isFollowUp) {
    return `Write a brief follow-up email. The student sent the initial email below 2 weeks ago and has not received a response.

The follow-up should be 3-5 sentences:
1. A short, polite reference to the previous email ("I wanted to follow up on my previous note")
2. One sentence restating their genuine interest in the professor's specific research
3. The ask, restated briefly
4. A warm close

Do NOT be pushy or apologetic. Keep it confident and brief.

FORMAT:
SUBJECT: Re: [original subject — keep same subject with Re: prefix]

[follow-up body]

STUDENT: ${student.name || "the student"}, ${student.grade || "11th grade"} at ${student.school || "high school"}
PROFESSOR: ${prof.name || "Professor"}, ${prof.institution || ""}

ORIGINAL EMAIL SENT:
${originalEmail}

Write the follow-up now:`;
  }

  return `Write a cold email from a high school student to a professor. Write it AS the student in first person. Sound exactly like a real student wrote it — NOT an AI or template.

TONE: Formal but genuine. Smart and driven. Confident, not corporate.

NEVER USE: "I hope this email finds you well", "I am reaching out", "I wanted to touch base", "leverage", "synergy", "I am writing to", "I would like to express my interest"

CRITICAL — NO HALLUCINATION:
- Use ONLY information explicitly provided below
- Do NOT invent clubs, awards, statistics, or projects not listed
- If a field is empty, omit that aspect entirely
- Write a shorter accurate email rather than a longer fabricated one

STRUCTURE:
1. SUBJECT: Specific and attention-grabbing. Include a time hook naturally.
2. SALUTATION: "Dear Professor [LastName],"
3. OPENING (1-2 sentences): Acknowledge their time directly.
4. HOW I FOUND YOU + CONNECTION (2-3 sentences): Name, school, grade, and a genuine story connecting their specific research to something the student was already doing. Reference an actual technique or topic from the research summary.
5. CREDIBILITY (2-3 sentences): Student's ACTUAL accomplishments with specific details. Lead with what's most relevant to this professor's field. Do not invent anything.
6. THE ASK (1-2 sentences): Modest and specific. Make it easy to say yes.
7. SIGN-OFF: Warm and brief. Student's name only.

LENGTH: 150-200 words. No filler.

FORMAT:
SUBJECT: [subject line]

[email body]

STUDENT:
Name: ${student.name || "the student"}
Grade: ${student.grade || "11th grade"}, ${student.school || "high school"}
Interests: ${interests || "(not provided — omit)"}
Experience: ${experience || "(not provided — write around this)"}
How found: ${discovery || "(not specified)"}
Ask: ${goal}

PROFESSOR:
Name: ${prof.name || "Professor"}
Institution: ${prof.institution || ""}
Department: ${prof.department || ""}
Research: ${research || "(not provided)"}

Write the email now:`;
}

// ─── Email Generation (server-side via Vercel + Groq) ────────────────────
async function generateViaServer(prompt) {
  const resp = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${resp.status}`);
  }

  const data = await resp.json();
  return data.email;
}

// Fallback: local model via offscreen
async function generateViaLocal(prompt) {
  const status = await chrome.runtime.sendMessage({ type: "GET_MODEL_STATUS" }).catch(() => null);
  if (!status?.loaded) throw new Error("Local model not loaded — check server connection");

  const resp = await chrome.runtime.sendMessage({
    type: "GENERATE_EMAIL",
    payload: { prompt },
  });

  if (!resp?.success) throw new Error(resp?.error || "Local generation failed");
  return resp.email;
}

async function generateEmail(prompt) {
  // Try server first, fall back to local model
  try {
    return await generateViaServer(prompt);
  } catch (serverErr) {
    console.warn("[ProfReach] Server failed, trying local:", serverErr.message);
    try {
      return await generateViaLocal(prompt);
    } catch (localErr) {
      throw new Error(`Server: ${serverErr.message}. Local: ${localErr.message}`);
    }
  }
}

// ─── Email Output ─────────────────────────────────────────────────────────
let currentEmailData = { subject: "", body: "" };
let currentProfData  = {};

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
  const output      = document.getElementById("email-output");
  const placeholder = document.getElementById("email-placeholder");
  const generating  = document.getElementById("email-generating");
  placeholder.classList.toggle("hidden", on || output.dataset.hasContent === "true");
  generating.classList.toggle("hidden", !on);
  output.classList.toggle("hidden", on);
}

async function doGenerate(isFollowUp = false, originalEmail = "") {
  const profile  = readProfile();
  const profData = readProfessorData();

  if (!profile.name || !profile.school) {
    profilePanel.classList.remove("hidden");
    showToast("Fill in your profile first (⚙)", true);
    return;
  }
  if (!profData.name) { showToast("Professor name is required", true); return; }

  currentProfData = profData;

  const genBtn   = document.getElementById("generate-btn");
  const regenBtn = document.getElementById("regenerate-btn");
  genBtn.disabled = true;
  if (regenBtn) regenBtn.disabled = true;
  setGenerating(true);
  document.getElementById("generating-text").textContent =
    isFollowUp ? "Writing follow-up…" : "Writing your email…";

  try {
    const prompt = buildPrompt(profile, profData, isFollowUp, originalEmail);
    const emailText = await generateEmail(prompt);

    setGenerating(false);
    renderEmailChunk(emailText);

    if (profile.attachResume && !isFollowUp) {
      const resumeLine = "\n\nI have attached my resume for your reference and would love to schedule a brief 15-minute call to discuss how I might contribute to your research.";
      document.getElementById("email-body").textContent += resumeLine;
      currentEmailData.body += resumeLine;
    }

    const output = document.getElementById("email-output");
    output.dataset.hasContent = "true";
    output.classList.remove("hidden");
    document.getElementById("email-placeholder").classList.add("hidden");

    // Save to history (only initial emails, not follow-ups from main generate)
    if (!isFollowUp) {
      await saveToHistory(profData, currentEmailData);
    }

  } catch (err) {
    setGenerating(false);
    showToast("Error: " + err.message, true);
    console.error("[ProfReach] Generation error:", err);
  } finally {
    genBtn.disabled = false;
    if (regenBtn) regenBtn.disabled = false;
  }
}

document.getElementById("generate-btn").addEventListener("click",   () => doGenerate());
document.getElementById("regenerate-btn").addEventListener("click", () => doGenerate());
document.getElementById("followup-btn").addEventListener("click",   () => {
  if (!currentEmailData.body) { showToast("Generate an email first", true); return; }
  const originalText = `Subject: ${currentEmailData.subject}\n\n${currentEmailData.body}`;
  doGenerate(true, originalText);
});

// ─── Email Actions ────────────────────────────────────────────────────────
document.getElementById("copy-btn").addEventListener("click", async () => {
  const { subject, body } = currentEmailData;
  const text = subject ? `Subject: ${subject}\n\n${body}` : body;
  await navigator.clipboard.writeText(text);
  showToast("Copied ✓");
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
  btn.textContent = "Save Draft"; btn.disabled = false;
  if (resp?.success) showToast("Draft saved to Gmail ✓");
  else showToast("Draft failed: " + (resp?.error || "set up Gmail first"), true);
});

// ─── History ─────────────────────────────────────────────────────────────
const historyPanel = document.getElementById("history-panel");

document.getElementById("history-toggle").addEventListener("click", () => {
  profilePanel.classList.add("hidden");
  historyPanel.classList.toggle("hidden");
  if (!historyPanel.classList.contains("hidden")) renderHistory();
});

document.getElementById("history-close").addEventListener("click", () => historyPanel.classList.add("hidden"));

async function loadHistory() {
  const { emailHistory } = await getStorage("emailHistory");
  return emailHistory || [];
}

async function saveToHistory(profData, emailData) {
  const history = await loadHistory();
  const entry = {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    professor: {
      name:        profData.name,
      email:       profData.email,
      institution: profData.institution,
      department:  profData.department,
    },
    email: {
      subject: emailData.subject,
      body:    emailData.body,
    },
    followUp: null,
  };

  history.unshift(entry); // newest first
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  await setStorage({ emailHistory: history });
}

async function saveFollowUpToHistory(entryId, followUpData) {
  const history = await loadHistory();
  const entry = history.find(e => e.id === entryId);
  if (entry) {
    entry.followUp = followUpData;
    await setStorage({ emailHistory: history });
  }
}

async function deleteHistoryEntry(entryId) {
  const history = await loadHistory();
  const filtered = history.filter(e => e.id !== entryId);
  await setStorage({ emailHistory: filtered });
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function renderHistory() {
  const history = await loadHistory();
  const emptyEl = document.getElementById("history-empty");
  const listEl  = document.getElementById("history-list");

  if (history.length === 0) {
    emptyEl.classList.remove("hidden");
    listEl.classList.add("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  listEl.classList.remove("hidden");
  listEl.innerHTML = "";

  history.forEach(entry => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.dataset.id = entry.id;

    const profDisplay = entry.professor.name +
      (entry.professor.institution ? ` · ${entry.professor.institution}` : "");

    item.innerHTML = `
      <div class="history-item-header">
        <div class="history-meta">
          <div class="history-prof-name">${escapeHtml(entry.professor.name)}</div>
          <div class="history-subject">${escapeHtml(entry.email.subject || "No subject")}</div>
        </div>
        <span class="history-date">${formatDate(entry.date)}</span>
        <span class="history-chevron">›</span>
      </div>
      <div class="history-item-body">
        <div class="history-email-section">
          <div class="history-section-label">Initial Email</div>
          <div class="history-email-text">${escapeHtml(entry.email.body)}</div>
        </div>

        ${entry.followUp ? `
        <div class="history-email-section history-followup-section">
          <div class="history-section-label">Follow-up</div>
          <div class="history-email-text">${escapeHtml(entry.followUp.body)}</div>
        </div>
        ` : ""}

        <div class="history-item-actions">
          <button class="btn-secondary btn-sm hist-copy" data-id="${entry.id}">Copy</button>
          <button class="btn-secondary btn-sm hist-gmail" data-id="${entry.id}">Gmail</button>
          ${!entry.followUp
            ? `<button class="btn-secondary btn-sm hist-followup" data-id="${entry.id}">+ Follow-up</button>`
            : `<button class="btn-secondary btn-sm hist-copy-followup" data-id="${entry.id}">Copy Follow-up</button>`
          }
          <button class="btn-danger hist-delete" data-id="${entry.id}" style="margin-left:auto">Delete</button>
        </div>
      </div>
    `;

    // Toggle open/close
    item.querySelector(".history-item-header").addEventListener("click", () => {
      item.classList.toggle("open");
    });

    // Copy initial email
    item.querySelector(".hist-copy").addEventListener("click", async (e) => {
      e.stopPropagation();
      const h = history.find(x => x.id === entry.id);
      if (!h) return;
      const text = `Subject: ${h.email.subject}\n\n${h.email.body}`;
      await navigator.clipboard.writeText(text);
      showToast("Copied ✓");
    });

    // Open in Gmail
    item.querySelector(".hist-gmail").addEventListener("click", (e) => {
      e.stopPropagation();
      const p = new URLSearchParams({
        to: entry.professor.email || "",
        su: entry.email.subject || "",
        body: entry.email.body || "",
      });
      chrome.tabs.create({ url: `https://mail.google.com/mail/?view=cm&fs=1&${p}` });
    });

    // Generate follow-up
    const followupBtn = item.querySelector(".hist-followup");
    if (followupBtn) {
      followupBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        followupBtn.textContent = "Writing…";
        followupBtn.disabled = true;

        try {
          const profile = readProfile();
          const originalText = `Subject: ${entry.email.subject}\n\n${entry.email.body}`;
          const prompt = buildPrompt(profile, entry.professor, true, originalText);
          const followUpText = await generateEmail(prompt);
          const parsed = parseEmailText(followUpText);

          await saveFollowUpToHistory(entry.id, parsed);
          showToast("Follow-up generated ✓");
          renderHistory(); // re-render to show follow-up
        } catch (err) {
          showToast("Error: " + err.message, true);
          followupBtn.textContent = "+ Follow-up";
          followupBtn.disabled = false;
        }
      });
    }

    // Copy follow-up
    const copyFollowupBtn = item.querySelector(".hist-copy-followup");
    if (copyFollowupBtn) {
      copyFollowupBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const h = history.find(x => x.id === entry.id);
        if (!h?.followUp) return;
        const text = `Subject: Re: ${h.email.subject}\n\n${h.followUp.body}`;
        await navigator.clipboard.writeText(text);
        showToast("Follow-up copied ✓");
      });
    }

    // Delete
    item.querySelector(".hist-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      await deleteHistoryEntry(entry.id);
      showToast("Deleted");
      renderHistory();
    });

    listEl.appendChild(item);
  });
}

function escapeHtml(str) {
  return (str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ─── License ─────────────────────────────────────────────────────────────
document.getElementById("activate-btn").addEventListener("click", async () => {
  const key     = document.getElementById("license-input").value.trim();
  const errorEl = document.getElementById("license-error");
  const btn     = document.getElementById("activate-btn");
  if (!key) { errorEl.textContent = "Please enter a key."; errorEl.classList.remove("hidden"); return; }
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
    t.style.cssText = "position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#1e2436;border:1px solid #2a3148;border-radius:5px;padding:6px 14px;font-size:12px;color:#e8e6df;box-shadow:0 4px 16px rgba(0,0,0,0.4);z-index:9999;transition:opacity 0.2s;pointer-events:none;";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.borderColor = isError ? "#e06c75" : "#2a3148";
  t.style.opacity = "1";
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.style.opacity = "0"; }, 2800);
}

// ─── Init ─────────────────────────────────────────────────────────────────
async function initMain() {
  addCharCounter("student-interests",  LIMITS.interests);
  addCharCounter("student-experience", LIMITS.experience);
  addCharCounter("student-goal",       LIMITS.goal);
  addCharCounter("student-discovery",  LIMITS.discovery);
  addCharCounter("prof-research",      LIMITS.researchSummary);

  await loadProfile();

  const profData = await extractFromPage();
  if (profData) fillProfessorFields(profData);

  document.getElementById("prof-name")?.addEventListener("input", () => {
    document.getElementById("generate-btn").disabled =
      !document.getElementById("prof-name").value.trim();
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
