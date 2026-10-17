import { PipelineError } from "../core/errors";
import type { Source } from "./types";

// TODO(节点 2/3)：实现抓取逻辑
export const deepseekSource: Source = {
  id: "deepseek",
  platform: "official",
  kind: "html",
  timeoutMs: 30000,
  async fetch() {
    throw new PipelineError("E2001", "deepseek 抓取器尚未实现", { sourceId: "deepseek" });
  },
};
