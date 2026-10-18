import type { APIRoute } from "astro";
import { changesIndexPayload, jsonResponse } from "../../../../lib/api";
import { getSiteModel } from "../../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(changesIndexPayload(getSiteModel()));
