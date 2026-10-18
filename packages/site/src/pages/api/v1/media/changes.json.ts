import type { APIRoute } from "astro";
import { mediaChangesPayload, jsonResponse } from "../../../../lib/api";
import { getSiteModel } from "../../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(mediaChangesPayload(getSiteModel()));
