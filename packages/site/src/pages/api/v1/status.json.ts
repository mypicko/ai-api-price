import type { APIRoute } from "astro";
import { statusPayload, jsonResponse } from "../../../lib/api";
import { getSiteModel } from "../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(statusPayload(getSiteModel()));
