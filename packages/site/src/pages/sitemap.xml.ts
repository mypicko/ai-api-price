import type { APIRoute } from "astro";
import { sitemapResponse } from "../lib/endpoints";

export const GET: APIRoute = ({ site }) => sitemapResponse(site);
