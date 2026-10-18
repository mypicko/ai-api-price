import { aliyunSource } from "./aliyun";
import { deepseekSource } from "./deepseek";
import { litellmSource } from "./litellm";
import { manualSource } from "./manual";
import { modelsdevCnSource, modelsdevSiliconflowCnSource } from "./modelsdev";
import { moonshotSource } from "./moonshot";
import { openrouterSource } from "./openrouter";
import { siliconflowSource } from "./siliconflow";
import type { Source } from "./types";
import { volcengineSource } from "./volcengine";
import { zhipuSource } from "./zhipu";

/**
 * 全部数据源。qianfan 暂未注册：定价页境外不可达（见 sources/qianfan.ts），等 manual 兜底或国内运行模式。
 * 顺序无关（并发执行），但优先级见 steps/normalize 的 SOURCE_PRIORITY */
export const ALL_SOURCES: readonly Source[] = [
  litellmSource,
  openrouterSource,
  deepseekSource,
  aliyunSource,
  zhipuSource,
  moonshotSource,
  volcengineSource,
  siliconflowSource,
  modelsdevCnSource,
  modelsdevSiliconflowCnSource,
  manualSource,
];

export function selectSources(enabled: readonly string[] | null): readonly Source[] {
  if (!enabled || enabled.length === 0) return ALL_SOURCES;
  return ALL_SOURCES.filter((source) => enabled.includes(source.id));
}
