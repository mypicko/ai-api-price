import type { APIRoute } from "astro";
import { mediaPayload, jsonResponse } from "../../../lib/api";
import { getSiteModel } from "../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(mediaPayload(getSiteModel()));
