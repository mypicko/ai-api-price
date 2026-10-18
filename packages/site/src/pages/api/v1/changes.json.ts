import type { APIRoute } from "astro";
import { changesPayload, jsonResponse } from "../../../lib/api";
import { getSiteModel } from "../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(changesPayload(getSiteModel()));
