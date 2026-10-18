import type { APIRoute, GetStaticPaths } from "astro";
import { jsonResponse, modelPayload } from "../../../../../lib/api";
import { getSiteModel } from "../../../../../lib/site-data";
import type { ModelInfo } from "../../../../../lib/site-model";

export const getStaticPaths = (() =>
  getSiteModel().models.map((info) => ({
    params: { vendor: info.vendor, model: info.model },
    props: { info },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ info: ModelInfo }> = ({ props }) =>
  jsonResponse(modelPayload(getSiteModel(), props.info));
