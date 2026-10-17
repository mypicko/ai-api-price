import { aliyunSource } from "./aliyun";
import { deepseekSource } from "./deepseek";
import { litellmSource } from "./litellm";
import { manualSource } from "./manual";
import { moonshotSource } from "./moonshot";
import { openrouterSource } from "./openrouter";
import { qianfanSource } from "./qianfan";
import { siliconflowSource } from "./siliconflow";
import type { Source } from "./types";
import { volcengineSource } from "./volcengine";
import { zhipuSource } from "./zhipu";

/** 全部数据源。顺序无关（并发执行），但优先级见 steps/normalize 的 SOURCE_PRIORITY */
export const ALL_SOURCES: readonly Source[] = [
  litellmSource,
  openrouterSource,
  deepseekSource,
  aliyunSource,
  zhipuSource,
  moonshotSource,
  volcengineSource,
  qianfanSource,
  siliconflowSource,
  manualSource,
];

export function selectSources(enabled: readonly string[] | null): readonly Source[] {
  if (!enabled || enabled.length === 0) return ALL_SOURCES;
  return ALL_SOURCES.filter((source) => enabled.includes(source.id));
}
