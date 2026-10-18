import type { APIRoute } from "astro";
import { latestPayload, jsonResponse } from "../../../lib/api";
import { getSiteModel } from "../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(latestPayload(getSiteModel()));
