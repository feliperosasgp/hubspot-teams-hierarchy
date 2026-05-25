/**
 * Step 2 — Flatten the team tree and download as CSV
 *
 * Run this AFTER 01_fetch_tree.js has populated window.__teamsTree.
 *
 * Adapt COUNTRY_ROOT_PATTERN to match your own root team naming convention.
 * Example: if your root teams are named "MX - Mexico", "CO - Colombia", etc.,
 * the pattern /^[A-Z]{2}\s*-\s*/ would strip the prefix and leave the country name.
 */

(() => {
  if (!window.__teamsTree) {
    console.error("Run 01_fetch_tree.js first to populate window.__teamsTree.");
    return;
  }

  // ─── CONFIG ─────────────────────────────────────────────────────────────────
  // Adapt this regex to match YOUR root team naming convention.
  // It is used to detect depth-0 "country root" nodes and derive a country label.
  const COUNTRY_ROOT_PATTERN = /^{YOUR_ROOT_PREFIX}\s*-\s*/;
  // ────────────────────────────────────────────────────────────────────────────

  const flatten = (nodes, parentName = null, country = null, depth = 0) => {
    return nodes.flatMap(n => {
      const isCountryRoot = depth === 0 && COUNTRY_ROOT_PATTERN.test(n.name);
      const currentCountry = isCountryRoot
        ? n.name.replace(COUNTRY_ROOT_PATTERN, "").trim()
        : country;

      return [
        {
          team_id:          n.id,
          team_name:        n.name,
          parent_team_id:   n.parentTeamId,
          parent_team_name: parentName,
          country:          currentCountry,
          depth,
          is_country_root:  isCountryRoot,
          is_leaf:          n.children.length === 0
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

  // Download directly (avoids clipboard / focus issues in DevTools)
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `hubspot_team_hierarchy_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  console.log(`✅ Downloaded ${flat.length} rows`);
  console.table(flat.slice(0, 5));
})();
