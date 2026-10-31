import { describe, expect, it } from "vitest";
import { inferVendorHint, resellerModelName } from "../../src/sources/reseller-model";

describe("reseller-model：转售平台的模型路径 → 厂商 + 模型名", () => {
  it.each([
    ["us.anthropic.claude-3-5-sonnet-20240620-v1:0", "anthropic", "claude-3-5-sonnet-20240620"],
    ["anthropic.claude-sonnet-4-5-20250929-v1:0", "anthropic", "claude-sonnet-4-5-20250929"],
    ["meta.llama3-1-70b-instruct-v1:0", "meta", "llama-3-1-70b-instruct"],
    ["llama3.1-70b", "meta", "llama-3.1-70b"],
    ["databricks-meta-llama-3-1-70b-instruct", "meta", "llama-3-1-70b-instruct"],
    ["llama-3.3-70b-instruct-maas", "meta", "llama-3.3-70b-instruct"],
    ["llama-3.1-8b-instruct-fp8", "meta", "llama-3.1-8b-instruct-fp8"],
    ["amazon.nova-pro-v1:0", "amazon", "nova-pro"],
    ["claude-3-5-haiku@20241022", "anthropic", "claude-3-5-haiku-20241022"],
    ["eu/gpt-4o-2024-08-06", "openai", "gpt-4o-2024-08-06"],
    ["accounts/fireworks/models/deepseek-v3", "deepseek", "deepseek-v3"],
    ["deepseek-ai/DeepSeek-V3-0324", "deepseek", "DeepSeek-V3-0324"],
    ["Qwen/Qwen2.5-72B-Instruct", "alibaba", "Qwen2.5-72B-Instruct"],
    ["zai-org/GLM-4.7", "zhipu", "GLM-4.7"],
    ["MiniMaxAI/MiniMax-M2.5", "minimax", "MiniMax-M2.5"],
    ["moonshotai/Kimi-K2.5", "moonshot", "Kimi-K2.5"],
    ["openai/gpt-oss-120b", "openai", "gpt-oss-120b"],
    ["databricks-claude-opus-4-1", "anthropic", "claude-opus-4-1"],
    ["@cf/meta/llama-2-7b-chat-fp16", "meta", "llama-2-7b-chat-fp16"],
    ["gemini-2.5-flash", "google", "gemini-2.5-flash"],
    ["mistralai/mistral-large", "mistral", "mistral-large"],
    ["nvidia/Llama-3.1-Nemotron-70B-Instruct", "nvidia", "Llama-3.1-Nemotron-70B-Instruct"],
    ["grok-4", "x-ai", "grok-4"],
  ])("%s → %s / %s", (path, vendor, model) => {
    expect(inferVendorHint(path)).toBe(vendor);
    expect(resellerModelName(path)).toBe(model);
  });

  it("推断不出厂商的返回 null（例如按参数量分档的伪条目、社区微调模型）", () => {
    expect(inferVendorHint("together-ai-21.1b-41b")).toBeNull();
    expect(inferVendorHint("Gryphe/MythoMax-L2-13b")).toBeNull();
    expect(inferVendorHint("NousResearch/Hermes-3-Llama-3.1-70B")).toBeNull();
    expect(inferVendorHint("ai21.jamba-1-5-large-v1:0")).toBeNull();
  });

  it("第三方微调（与原版同名）跳过；Bedrock「厂商.模型」只在模型名认得出时去掉厂商前缀", () => {
    expect(inferVendorHint("arize-ai/qwen-2-1.5b-instruct")).toBeNull();
    expect(inferVendorHint("Qwen/Qwen2-1.5B-Instruct")).toBe("alibaba");
    expect(resellerModelName("deepseek.v3.2")).toBe("deepseek-v3.2");
    expect(resellerModelName("us-east-1/deepseek.v3.2")).toBe("deepseek-v3.2");
    expect(resellerModelName("qwen.qwen3-coder-next")).toBe("qwen3-coder-next");
    expect(resellerModelName("amazon.titan-text-express-v1")).toBe("titan-text-express");
    expect(resellerModelName("nvidia.nemotron-nano-12b-v2")).toBe("nemotron-nano-12b-v2");
    expect(resellerModelName("cohere.command-text-v14")).toBe("command-text");
  });
});
