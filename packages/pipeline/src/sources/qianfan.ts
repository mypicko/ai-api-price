/**
 * 百度千帆（文心）—— 暂不自动抓取，已从 registry 移除。
 * 计划入口：https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya（千帆 ModelBuilder 计费文档）
 * 2026-10-18 实测：cloud.baidu.com / qianfan.cloud.baidu.com / console.bce.baidu.com 在境外网络（含 GitHub Actions 所在网络）
 *   TCP 连接超时；ai.baidu.com、ernie.baidu.com 可达但没有 API 价格。没有可在境外访问的公开价格页或匿名接口。
 * 恢复方式：在国内网络人工核对价格后写 config/manual/qianfan.yaml（source: manual-qianfan，vendor: baidu），
 *   或在 P2「国内机器运行」模式下实现本抓取器并重新注册。
 * 最后核对：2026-10-18
 */
import { PipelineError } from "../core/errors";
import type { Source } from "./types";

export const QIANFAN_URL = "https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya";

export const qianfanSource: Source = {
  id: "qianfan",
  platform: "official",
  kind: "html",
  timeoutMs: 30_000,
  async fetch() {
    throw new PipelineError(
      "E1001",
      "qianfan：定价页在境外网络不可达，暂未实现自动抓取（见文件头注释）",
      { sourceId: "qianfan" },
    );
  },
};
