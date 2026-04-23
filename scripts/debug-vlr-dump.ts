import { writeFileSync } from "node:fs";
import { fetchVlrHtml, buildVlrUrl, parseVlrStatsHtml } from "../src/server/mercato/vlrScraper";

(async () => {
  const url = buildVlrUrl("all");
  console.log(`Fetching: ${url}`);
  const html = await fetchVlrHtml(url);
  writeFileSync("/tmp/vlr-dump.html", html);
  console.log(`Saved ${html.length} chars to /tmp/vlr-dump.html`);

  const rows = parseVlrStatsHtml(html);
  console.log(`Parsed ${rows.length} rows`);
  console.log();
  console.log("First 20 IGNs found:");
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.ign}  (team ${r.teamTag ?? "?"}, rounds ${r.rounds}, rating ${r.rating})`);
  }
  console.log();
  // Check if specific pros are in the raw HTML but missed by parsing
  const testIgns = ["Alfajer", "Boaster", "crashies", "SUYGETSU", "Shao", "sheydos"];
  console.log("Searching raw HTML for specific pros:");
  for (const ign of testIgns) {
    const found = html.toLowerCase().includes(`>${ign.toLowerCase()}<`)
      || html.toLowerCase().includes(ign.toLowerCase());
    console.log(`  ${ign}: ${found ? "PRESENT in HTML" : "NOT in HTML"}`);
  }
})();
