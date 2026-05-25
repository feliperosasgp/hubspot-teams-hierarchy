/**
 * Step 1 — Fetch the full HubSpot team hierarchy
 *
 * Run this in the DevTools Console while on:
 *   HubSpot → Settings → Users & Teams → Teams
 *
 * Before running:
 *   1. Open DevTools (F12) → Network → filter by Fetch/XHR
 *   2. Reload the page
 *   3. Find the request to /api/app-users/v1/teams?...&includeHierarchy=true
 *   4. Right-click → Copy → Copy as fetch
 *   5. Grab PORTAL_ID, CSRF_TOKEN, and LOCALE_TOKEN from that request
 */

(async () => {
  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  const PORTAL_ID   = "{YOUR_PORTAL_ID}";
  const CSRF_TOKEN  = "{YOUR_CSRF_TOKEN}";
  const LOCALE_TOKEN = "{YOUR_LOCALE_TOKEN}";
  // ────────────────────────────────────────────────────────────────────────────

  const url = `https://app.hubspot.com/api/app-users/v1/teams`
    + `?portalId=${PORTAL_ID}`
    + `&includeHierarchy=true`;

  const res = await fetch(url, {
    headers: {
      "accept": "application/json, text/javascript, */*; q=0.01",
      "x-hs-locale": LOCALE_TOKEN,
      "x-hubspot-csrf-hubspotapi": CSRF_TOKEN
    },
    credentials: "include",
    method: "GET"
  });

  if (!res.ok) {
    console.error(`❌ HTTP ${res.status} — your CSRF token probably expired. Refresh it from the Network tab.`);
    return;
  }

  const raw = await res.json();
  console.log(`✅ Pulled ${raw.length} root teams`);

  // Strip user IDs, keep only structural fields
  const clean = (node) => ({
    id: node.id,
    name: node.name,
    parentTeamId: node.parentTeamId,
    children: (node.childTeams || []).map(clean)
  });
  const tree = raw.map(clean);

  // Quick stats
  const count = (nodes) => nodes.reduce((acc, n) => acc + 1 + count(n.children), 0);
  console.log(`🌳 Total teams in hierarchy: ${count(tree)}`);

  // Expose globally so script 02 can consume it without re-fetching
  window.__teamsTree = tree;

  console.log("Tree saved to window.__teamsTree — run 02_flatten_to_csv.js next.");
  return tree;
})();
