/**
 * ProfReach — /api/health.js
 * Simple health check so the popup can confirm the server is reachable.
 */

module.exports = function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin.startsWith("chrome-extension://") ? origin : "");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  return res.status(200).json({ ok: true, service: "ProfReach API" });
};
