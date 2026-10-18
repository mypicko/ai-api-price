import type { APIRoute } from "astro";
import { robotsResponse } from "../lib/endpoints";

export const GET: APIRoute = ({ site }) => robotsResponse(site);
