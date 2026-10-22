import type { APIRoute, GetStaticPaths } from "astro";
import { modelOgResponse } from "../../../../lib/endpoints";
import { getSiteModel } from "../../../../lib/site-data";
import type { ModelInfo } from "../../../../lib/site-model";

export const getStaticPaths = (() =>
  getSiteModel().models.map((info) => ({
    params: { vendor: info.vendor, model: info.model },
    props: { info },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props, site }) =>
  modelOgResponse((props as { info: ModelInfo }).info, "zh", site);
