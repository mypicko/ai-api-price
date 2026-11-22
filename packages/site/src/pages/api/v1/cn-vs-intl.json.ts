import type { APIRoute } from "astro";
import { jsonResponse } from "../../../lib/api";
import { cnIntlPayload } from "../../../lib/cn-intl";
import { getSiteModel } from "../../../lib/site-data";

export const GET: APIRoute = () => jsonResponse(cnIntlPayload(getSiteModel()));
