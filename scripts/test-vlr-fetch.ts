/**
 * Minimal fetch test — isolates whether VLR is reachable at all from this
 * machine before running the full scraper. Prints the raw error + cause.
 */

const TARGET =
  "https://www.vlr.gg/stats/?event_group_id=86&region=all&min_rounds=1&min_rating=0&agent=all&map_id=all&timespan=60d";

(async () => {
  console.log(`Fetching: ${TARGET}`);
  try {
    const res = await fetch(TARGET, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    console.log(`Status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.log(`Body length: ${text.length} chars`);
    console.log(`First 400 chars:\n${text.slice(0, 400)}`);
    const hasTable = text.includes('class="wf-table-inset');
    console.log(`Has stats table: ${hasTable}`);
  } catch (err) {
    console.error("FETCH FAILED");
    console.error("Error:", err);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cause = (err as any)?.cause;
    if (cause) {
      console.error("Cause:", cause);
    }
  }
})();
