# How to Extract Your Full Team Hierarchy from HubSpot (Including `parentTeamId`)

**TL;DR:** HubSpot's public Settings API returns teams as a flat list with no parent–child relationship. If you have hundreds of teams nested across countries, regions, or dealer networks, the UI is the only place you can actually *see* the hierarchy — and it's virtualized, so DOM scraping breaks. This post shows a clean, browser-only workflow to pull the full tree as JSON or CSV in under a minute.

---

## The problem

If you've tried to programmatically reconcile teams with owners, deals, or any reporting dimension at scale, you've probably hit this wall:

- The public endpoint `GET /settings/v1/teams` returns teams as a flat array — **without `parentTeamId`**.
- The Teams settings UI is virtualized (likely `react-window` or similar). Only ~20–30 rows live in the DOM at any time. Scraping by selector returns whatever is visible at scroll position X.
- There's no native "export team hierarchy" button.

For anyone managing a multi-country org, a multi-brand portfolio, or a large dealer network in HubSpot, this is a real gap.

---

## What actually works

HubSpot's own UI loads the full hierarchy from an **internal endpoint** (not part of the public API). It returns a nested tree with `childTeams`, `parentTeamId`, and everything you need.

⚠️ **Important caveat:** this is an undocumented internal endpoint. HubSpot can change it without notice. **Don't bake it into a production pipeline.** Use it for one-off audits, manual refreshes, or generating reference tables you can reload when needed.

---

## Step 1 — Find the request

1. Log into HubSpot.
2. Go to **Settings → Users & Teams → Teams**.
3. Open DevTools (`F12` or `Cmd+Opt+I`) → **Network** tab → filter by **Fetch/XHR**.
4. Reload the page.
5. Look for a request to a path like `/api/app-users/v1/teams` with a query parameter `includeHierarchy=true`.
6. Right-click the request → **Copy → Copy as fetch**.

You'll get something like:

```javascript
fetch("https://app.hubspot.com/api/app-users/v1/teams?portalId={YOUR_PORTAL_ID}&...&includeHierarchy=true", {
  "headers": {
    "accept": "application/json, text/javascript, */*; q=0.01",
    "x-hs-locale": "{YOUR_LOCALE_TOKEN}",
    "x-hubspot-csrf-hubspotapi": "{YOUR_CSRF_TOKEN}"
  },
  "credentials": "include",
  "method": "GET"
});
```

The two values you absolutely need are:
- `x-hubspot-csrf-hubspotapi` — your session's CSRF token (rotates frequently).
- `credentials: "include"` — sends your session cookie automatically.

---

## Step 2 — Fetch + clean + download

Paste this in the DevTools Console while on the Teams settings page. Replace the placeholders with values from your copied request.

```javascript
(async () => {
  // ─── CONFIG ───────────────────────────────────────────────
  const PORTAL_ID = "{YOUR_PORTAL_ID}";
  const CSRF_TOKEN = "{YOUR_CSRF_TOKEN}";
  const LOCALE_TOKEN = "{YOUR_LOCALE_TOKEN}";
  // ──────────────────────────────────────────────────────────

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

  // Expose globally so you can re-run flatten/export without re-fetching
  window.__teamsTree = tree;

  console.log("Tree saved to window.__teamsTree");
  return tree;
})();
```

If you get a **401**, your CSRF token expired. Refresh the page in HubSpot, grab the new token from the Network tab, and re-run.

---

## Step 3 — Flatten to CSV (for BigQuery, Sheets, Snowflake, etc.)

This adds two useful derived fields:
- `country` — propagated from the first-level root if it matches a country naming pattern.
- `depth` — how deep in the tree this team sits.
- `is_leaf` — true if it has no children (i.e., a real working team, not just an org node).

Adapt the regex on line `isCountryRoot` to match your own root naming convention.

```javascript
(() => {
  if (!window.__teamsTree) {
    console.error("Run the previous script first.");
    return;
  }

  // Adapt this pattern to YOUR root team naming convention
  const COUNTRY_ROOT_PATTERN = /^{YOUR_ROOT_PREFIX}\s*-\s*/;

  const flatten = (nodes, parentName = null, country = null, depth = 0) => {
    return nodes.flatMap(n => {
      const isCountryRoot = depth === 0 && COUNTRY_ROOT_PATTERN.test(n.name);
      const currentCountry = isCountryRoot
        ? n.name.replace(COUNTRY_ROOT_PATTERN, "").trim()
        : country;

      return [
        {
          team_id: n.id,
          team_name: n.name,
          parent_team_id: n.parentTeamId,
          parent_team_name: parentName,
          country: currentCountry,
          depth,
          is_country_root: isCountryRoot,
          is_leaf: n.children.length === 0
        },
        ...flatten(n.children, n.name, currentCountry, depth + 1)
      ];
    });
  };

  const flat = flatten(window.__teamsTree);

  // Build CSV
  const headers = Object.keys(flat[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(","),
    ...flat.map(row => headers.map(h => escape(row[h])).join(","))
  ].join("\n");

  // Download (bypasses clipboard focus issues)
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `hubspot_team_hierarchy_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  console.log(`✅ Downloaded ${flat.length} rows`);
  console.table(flat.slice(0, 5));
})();
```

You'll get a file like `hubspot_team_hierarchy_2026-01-15.csv` in your Downloads folder, ready to upload anywhere.

---

## Output shape

**Nested JSON (`window.__teamsTree`):**

```json
[
  {
    "id": 1234,
    "name": "Region A",
    "parentTeamId": null,
    "children": [
      {
        "id": 5678,
        "name": "Country X",
        "parentTeamId": 1234,
        "children": [
          { "id": 9012, "name": "Dealer Y", "parentTeamId": 5678, "children": [] }
        ]
      }
    ]
  }
]
```

**Flat CSV:**

| team_id | team_name   | parent_team_id | parent_team_name | country   | depth | is_country_root | is_leaf |
|---------|-------------|----------------|------------------|-----------|-------|-----------------|---------|
| 1234    | Region A    |                |                  | Region A  | 0     | true            | false   |
| 5678    | Country X   | 1234           | Region A         | Region A  | 1     | false           | false   |
| 9012    | Dealer Y    | 5678           | Country X        | Region A  | 2     | false           | true    |

---

## Use cases

Once you have the hierarchy in a queryable format, a lot of previously painful things become trivial:

- **Owner → team → country lookups** without hardcoding country names.
- **Audit orphaned teams** — roots that don't follow your naming convention often hint at governance gaps.
- **Cross-team rollup reporting** in BI tools (BigQuery, Looker, Tableau) where you can join contacts/deals against the flat hierarchy table.
- **Detect leaf vs. structural teams** — useful for reporting only on customer-facing units.
- **Spot duplicate or near-duplicate team names** at a glance.

---

## Caveats

- **Internal endpoint** — not officially supported by HubSpot. Could change or break at any time.
- **Manual refresh** — the CSRF token is session-bound. This is a manual workflow, not a cron job.
- **Read-only** — this only pulls the hierarchy. Don't try to use it to write changes.
- **Respect your portal's permissions** — you need access to view Teams settings for any of this to work.

For anything programmatic and recurring, build it on top of the public API and accept the flat-list limitation, or maintain your hierarchy mapping in a separate source of truth (e.g., a Google Sheet or a database table that you sync manually).

---

## Closing thought

The fact that this gap exists in the public API for orgs running hundreds or thousands of teams is genuinely surprising. If you're at HubSpot and reading this — please consider exposing `parentTeamId` (and ideally `includeHierarchy=true`) on the public `/settings/v1/teams` endpoint. It would unlock a meaningful class of reporting and governance workflows that today rely on workarounds like this one.

Hope this helps someone save an afternoon. 🙏