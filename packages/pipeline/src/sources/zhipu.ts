import { PipelineError } from "../core/errors";
import type { Source } from "./types";

// TODO(节点 2/3)：实现抓取逻辑
export const zhipuSource: Source = {
  id: "zhipu",
  platform: "official",
  kind: "browser",
  timeoutMs: 90000,
  async fetch() {
    throw new PipelineError("E2001", "zhipu 抓取器尚未实现", { sourceId: "zhipu" });
  },
};
