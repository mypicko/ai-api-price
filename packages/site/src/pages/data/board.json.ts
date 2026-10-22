import type { APIRoute } from "astro";
import { boardDataResponse } from "../../lib/endpoints";

export const GET: APIRoute = () => boardDataResponse("zh");
