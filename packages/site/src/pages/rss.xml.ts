import type { APIRoute } from "astro";
import { rssResponse } from "../lib/endpoints";

export const GET: APIRoute = ({ site }) => rssResponse("zh", site);
