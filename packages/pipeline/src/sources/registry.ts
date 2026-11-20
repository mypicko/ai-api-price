import { aliyunCnSource, aliyunSource } from "./aliyun";
import { deepinfraSource } from "./deepinfra";
import { deepseekSource } from "./deepseek";
import { hunyuanSource } from "./hunyuan";
import { litellmSource } from "./litellm";
import { litellmResellersSource } from "./litellm-resellers";
import { manualCnSource, manualSource } from "./manual";
import { modelsdevCnSource, modelsdevSiliconflowCnSource } from "./modelsdev";
import { moonshotCnSource, moonshotSource } from "./moonshot";
import { novitaSource } from "./novita";
import { openrouterSource } from "./openrouter";
import { openrouterEndpointsSource } from "./openrouter-endpoints";
import { qianfanSource } from "./qianfan";
import { siliconflowSource } from "./siliconflow";
import { siliconflowCnSource } from "./siliconflow-cn";
import type { Source } from "./types";
import { volcengineSource } from "./volcengine";
import { zhipuSource } from "./zhipu";

/**
 * 全部数据源。
 * 顺序无关（并发执行），但优先级见 steps/normalize 的 SOURCE_PRIORITY */
export const ALL_SOURCES: readonly Source[] = [
  litellmSource,
  litellmResellersSource,
  openrouterSource,
  openrouterEndpointsSource,
  deepinfraSource,
  novitaSource,
  deepseekSource,
  aliyunSource,
  aliyunCnSource,
  qianfanSource,
  hunyuanSource,
  zhipuSource,
  moonshotSource,
  moonshotCnSource,
  volcengineSource,
  siliconflowSource,
  siliconflowCnSource,
  modelsdevCnSource,
  modelsdevSiliconflowCnSource,
  manualSource,
  manualCnSource,
];

export function selectSources(enabled: readonly string[] | null): readonly Source[] {
  if (!enabled || enabled.length === 0) return ALL_SOURCES;
  return ALL_SOURCES.filter((source) => enabled.includes(source.id));
}
