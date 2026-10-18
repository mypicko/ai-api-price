import type { APIRoute, GetStaticPaths } from "astro";
import { changeMonths, changesMonthPayload, jsonResponse } from "../../../../lib/api";
import { getSiteModel } from "../../../../lib/site-data";

export const getStaticPaths = (() =>
  changeMonths(getSiteModel()).map((month) => ({ params: { month } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  jsonResponse(changesMonthPayload(getSiteModel(), params["month"] ?? ""));
