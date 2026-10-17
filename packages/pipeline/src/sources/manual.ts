import { PipelineError } from "../core/errors";
import type { Source } from "./types";

// TODO(节点 2/3)：实现抓取逻辑
export const manualSource: Source = {
  id: "manual",
  platform: "official",
  kind: "manual",
  timeoutMs: 5000,
  async fetch() {
    throw new PipelineError("E2001", "manual 抓取器尚未实现", { sourceId: "manual" });
  },
};
