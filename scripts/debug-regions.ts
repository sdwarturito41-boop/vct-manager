import {
  fetchVlrHtml,
  buildVlrUrl,
  parseVlrStatsHtml,
} from "../src/server/mercato/vlrScraper";

const REGIONS = ["eu", "cn", "na", "br", "jp", "kr", "ap", "las"];
const TEST_IGNS = [
  "Alfajer",
  "Boaster",
  "crashies",
  "SUYGETSU",
  "Shao",
  "Wo0t",
  "benjyfishy",
  "Carpe",
  "keznit",
  "whz",
];

(async () => {
  console.log("Testing each VLR region, scanning for known tier-1 pros:");
  console.log();

  for (const region of REGIONS) {
    const url = buildVlrUrl("all", region);
    try {
      const html = await fetchVlrHtml(url);
      const rows = parseVlrStatsHtml(html);
      const names = new Set(rows.map((r) => r.ign.toLowerCase()));
      const found = TEST_IGNS.filter((ign) => names.has(ign.toLowerCase()));
      console.log(`region=${region.padEnd(4)} → ${rows.length} rows | matches: ${found.join(", ") || "(none)"}`);
    } catch (err) {
      console.log(`region=${region.padEnd(4)} → FAILED: ${String(err).slice(0, 100)}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
})();
