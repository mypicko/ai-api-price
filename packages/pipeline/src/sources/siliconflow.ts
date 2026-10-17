import { PipelineError } from "../core/errors";
import type { Source } from "./types";

// TODO(节点 2/3)：实现抓取逻辑
export const siliconflowSource: Source = {
  id: "siliconflow",
  platform: "siliconflow",
  kind: "browser",
  timeoutMs: 90000,
  async fetch() {
    throw new PipelineError("E2001", "siliconflow 抓取器尚未实现", { sourceId: "siliconflow" });
  },
};
