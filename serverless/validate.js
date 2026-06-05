/**
 * ProfReach License Validation — Serverless Function
 *
 * Deploy to Vercel:  /api/validate.js
 * Deploy to Netlify: /netlify/functions/validate.js (adjust module.exports)
 *
 * Environment variables required:
 *   LICENSE_KEYS     — comma-separated list of valid keys, OR use a DB
 *   JWT_SECRET       — random 32+ char string for signing tokens
 *   MAX_DEVICES      — max activations per key (default: 3)
 *
 * For production, replace the in-memory key store with a database
 * (e.g., Vercel KV, PlanetScale, Supabase).
 */

const crypto = require("crypto");

// ─── Simple in-memory store (replace with DB in production) ──────────────
// In prod: { [key]: { activations: [fingerprint], createdAt, plan } }
// For MVP, just read from env var
const VALID_KEYS = new Set(
  (process.env.LICENSE_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean)
);

// Simulate per-key activation tracking (use Redis/KV in prod)
const activations = new Map(); // key -> Set of fingerprints

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production-32chars+";
const MAX_DEVICES = parseInt(process.env.MAX_DEVICES || "3", 10);
const TOKEN_TTL_DAYS = 7;

// ─── Minimal JWT (no library dependency) ─────────────────────────────────

function base64url(buf) {
  return buf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function signToken(payload) {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(
    crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  const [header, body, sig] = token.split(".");
  const expected = base64url(
    crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest()
  );
  if (sig !== expected) return null;
  const payload = JSON.parse(Buffer.from(body, "base64").toString());
  if (payload.exp < Date.now() / 1000) return null;
  return payload;
}

// ─── Handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS — only allow your extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { key, fingerprint } = req.body || {};

  if (!key || !fingerprint) {
    return res.status(400).json({ valid: false, reason: "Missing key or fingerprint" });
  }

  // Normalize key
  const normalizedKey = key.toUpperCase().trim();

  if (!VALID_KEYS.has(normalizedKey)) {
    return res.status(200).json({ valid: false, reason: "Invalid license key" });
  }

  // Check device limit
  if (!activations.has(normalizedKey)) {
    activations.set(normalizedKey, new Set());
  }

  const keyActivations = activations.get(normalizedKey);

  if (!keyActivations.has(fingerprint) && keyActivations.size >= MAX_DEVICES) {
    return res.status(200).json({
      valid: false,
      reason: `This key is already activated on ${MAX_DEVICES} devices. Contact support to reset.`,
    });
  }

  // Register this device
  keyActivations.add(fingerprint);

  // Issue token
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_DAYS * 86400;
  const token = signToken({
    key: normalizedKey,
    fingerprint,
    exp: expiresAt,
    iat: Math.floor(Date.now() / 1000),
  });

  return res.status(200).json({
    valid: true,
    token,
    expiresAt: expiresAt * 1000, // ms for JS Date
  });
};

// ─── Vercel KV upgrade path (commented example) ───────────────────────────
/*
import { kv } from "@vercel/kv";

async function checkAndRegisterDevice(key, fingerprint) {
  const record = await kv.get(`license:${key}`) || { devices: [], plan: "basic" };

  if (!record.devices.includes(fingerprint)) {
    if (record.devices.length >= MAX_DEVICES) return false;
    record.devices.push(fingerprint);
    await kv.set(`license:${key}`, record);
  }
  return true;
}
*/
