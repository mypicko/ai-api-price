import { PipelineError } from "../core/errors";
import type { Source } from "./types";

// TODO(节点 2/3)：实现抓取逻辑
export const openrouterSource: Source = {
  id: "openrouter",
  platform: "openrouter",
  kind: "api",
  timeoutMs: 30000,
  async fetch() {
    throw new PipelineError("E2001", "openrouter 抓取器尚未实现", { sourceId: "openrouter" });
  },
};
