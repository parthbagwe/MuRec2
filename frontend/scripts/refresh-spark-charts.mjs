import { mkdir, writeFile } from "node:fs/promises";
import { fetchAppleCharts } from "../server/chartFeed.js";

const target = new URL("../public/catalogue/", import.meta.url);
await mkdir(target, { recursive: true });
for (const country of ["in", "us"]) {
  const chart = await fetchAppleCharts(country);
  chart.snapshot = true;
  chart.tracks = chart.tracks.map((track) => ({ ...track, track_id: track.track_id.replace(`chart-${country}-`, "apple-") }));
  await writeFile(new URL(`charts-${country}.json`, target), JSON.stringify(chart));
  console.log(`${country}: ${chart.tracks.length} chart positions saved, ${chart.tracks.filter((track) => track.preview_url).length} previews. Snapshot: ${chart.updated_at}`);
}
