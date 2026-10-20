import type { APIRoute } from "astro";
import { jsonResponse, plansPayload } from "../../../lib/api";
import { getSiteModel } from "../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(plansPayload(getSiteModel()));
