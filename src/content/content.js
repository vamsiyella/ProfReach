/**
 * ProfReach Content Script
 * Extracts professor information from any academic webpage.
 * Runs at document_idle — safe to query the full DOM.
 */

(function () {
  "use strict";

  // ─── Utilities ────────────────────────────────────────────────────────────

  const getText = (el) => el?.textContent?.trim() ?? "";
  const clean = (str) => str.replace(/\s+/g, " ").trim();

  /** Score a candidate string — higher = more likely to be a real name */
  function nameScore(str) {
    if (!str || str.length < 3 || str.length > 60) return 0;
    const words = str.trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) return 0;
    // Each word should be title-cased and alphabetic
    const allTitleCase = words.every((w) => /^[A-Z][a-z'-]+$/.test(w));
    if (!allTitleCase) return 0;
    // Penalize if it contains common non-name words
    const noise = /department|university|college|school|professor|research|lab|center/i;
    if (noise.test(str)) return 0;
    return words.length === 2 ? 3 : 2;
  }

  // ─── Name Extraction ──────────────────────────────────────────────────────

  function extractName() {
    const candidates = [];

    // 1. og:title / meta name (often "Dr. Jane Smith | MIT")
    const og = document.querySelector('meta[property="og:title"]')?.content;
    if (og) {
      const part = og.split(/[|\-–]/)[0].replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, "");
      candidates.push({ val: clean(part), score: nameScore(clean(part)) + 1 });
    }

    // 2. <title> tag
    const titlePart = document.title.split(/[|\-–,]/)[0]
      .replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, "");
    candidates.push({ val: clean(titlePart), score: nameScore(clean(titlePart)) });

    // 3. h1 tags
    document.querySelectorAll("h1").forEach((h) => {
      const t = clean(getText(h)).replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, "");
      candidates.push({ val: t, score: nameScore(t) + 2 });
    });

    // 4. Elements with itemprop="name"
    document.querySelectorAll('[itemprop="name"]').forEach((el) => {
      const t = clean(getText(el));
      candidates.push({ val: t, score: nameScore(t) + 2 });
    });

    // 5. Elements with class/id hints
    const nameSelectors = [
      ".faculty-name", ".prof-name", ".person-name", ".author-name",
      "#faculty-name", ".profile-name", ".pi-name", ".researcher-name",
      '[class*="name"]', '[id*="name"]'
    ];
    nameSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        const t = clean(getText(el)).replace(/^(Dr\.?|Prof\.?|Professor)\s+/i, "");
        candidates.push({ val: t, score: nameScore(t) + 1 });
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.score > 0 ? candidates[0].val : "";
  }

  // ─── Email Extraction ─────────────────────────────────────────────────────

  function extractEmail() {
    // 1. mailto: links
    const mailto = document.querySelector('a[href^="mailto:"]');
    if (mailto) {
      const email = mailto.href.replace("mailto:", "").split("?")[0].trim();
      if (email.includes("@")) return email;
    }

    // 2. Obfuscated emails in text (common on academia pages)
    const body = document.body.innerText;
    const emailRegex = /[a-zA-Z0-9._%+\-]+\s*[@\[at\]]\s*[a-zA-Z0-9.\-]+\s*[.]\s*[a-zA-Z]{2,}/g;
    const matches = body.match(emailRegex);
    if (matches) {
      const cleaned = matches[0]
        .replace(/\s*\[at\]\s*/i, "@")
        .replace(/\s*\[dot\]\s*/i, ".")
        .replace(/\s+/g, "");
      if (cleaned.includes("@")) return cleaned;
    }

    return "";
  }

  // ─── Institution Extraction ───────────────────────────────────────────────

  function extractInstitution() {
    // Try meta tags
    const og = document.querySelector('meta[property="og:site_name"]')?.content;
    if (og) return clean(og);

    // Try common selectors
    const selectors = [
      ".university-name", ".institution", ".affiliation",
      '[class*="university"]', '[class*="institution"]', ".site-title", ".brand"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return clean(getText(el));
    }

    // Fall back to domain heuristic
    const host = window.location.hostname.replace("www.", "");
    const parts = host.split(".");
    if (parts.length >= 2) {
      return parts[parts.length - 2].replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return "";
  }

  // ─── Research Summary Extraction ──────────────────────────────────────────

  function extractResearch() {
    const researchKeywords = [
      "research", "interests", "about", "work", "overview",
      "projects", "focus", "bio", "biography", "lab"
    ];

    // Try to find sections with research-related headings
    const headings = document.querySelectorAll("h1, h2, h3, h4");
    for (const heading of headings) {
      const text = getText(heading).toLowerCase();
      if (researchKeywords.some((kw) => text.includes(kw))) {
        // Collect following sibling paragraphs
        const paragraphs = [];
        let sibling = heading.nextElementSibling;
        let depth = 0;
        while (sibling && depth < 5) {
          const tag = sibling.tagName.toLowerCase();
          if (["h1", "h2", "h3"].includes(tag)) break; // hit next section
          const p = clean(getText(sibling));
          if (p.length > 40) paragraphs.push(p);
          sibling = sibling.nextElementSibling;
          depth++;
        }
        if (paragraphs.length > 0) {
          return paragraphs.slice(0, 3).join(" ").slice(0, 800);
        }
      }
    }

    // Fallback: biggest paragraph on the page
    let best = "";
    document.querySelectorAll("p").forEach((p) => {
      const t = clean(getText(p));
      if (t.length > best.length && t.length < 1200) best = t;
    });
    return best.slice(0, 800);
  }

  // ─── Department Extraction ────────────────────────────────────────────────

  function extractDepartment() {
    const selectors = [
      ".department", ".dept", '[class*="department"]',
      '[itemprop="worksFor"]', ".position", ".title"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return clean(getText(el));
    }

    // Search in page text for "Department of X"
    const match = document.body.innerText.match(/Department\s+of\s+([A-Za-z\s&,]+)/);
    if (match) return "Department of " + match[1].trim().split("\n")[0];

    return "";
  }

  // ─── Main Extraction ──────────────────────────────────────────────────────

  function extractProfessorData() {
    return {
      name: extractName(),
      email: extractEmail(),
      institution: extractInstitution(),
      department: extractDepartment(),
      researchSummary: extractResearch(),
      pageUrl: window.location.href,
      pageTitle: document.title,
    };
  }

  // ─── Message Listener ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "EXTRACT_PROFESSOR_DATA") {
      try {
        const data = extractProfessorData();
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return true; // keep channel open for async
  });
})();
