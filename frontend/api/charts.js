import { fetchAppleCharts } from "../server/chartFeed.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ detail: "Method not allowed" });
  }
  try {
    const data = await fetchAppleCharts(request.query?.country);
    response.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    return response.status(200).json(data);
  } catch (error) {
    console.error("[charts-fallback] Apple feed failed", { message: error instanceof Error ? error.message : String(error) });
    return response.status(502).json({ detail: "The public chart feed is temporarily unavailable." });
  }
}
