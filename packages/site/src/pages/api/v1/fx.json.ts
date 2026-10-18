import type { APIRoute } from "astro";
import { fxPayload, jsonResponse } from "../../../lib/api";
import { getSiteModel } from "../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(fxPayload(getSiteModel()));
