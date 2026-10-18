import type { APIRoute } from "astro";
import { providersPayload, jsonResponse } from "../../../lib/api";
import { getSiteModel } from "../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(providersPayload(getSiteModel()));
