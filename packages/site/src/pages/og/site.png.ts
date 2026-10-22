import type { APIRoute } from "astro";
import { siteOgResponse } from "../../lib/endpoints";

export const GET: APIRoute = ({ site }) => siteOgResponse("zh", site);
