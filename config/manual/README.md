# 手动兜底价格

抓不到的厂商在这里放 `<source>.yaml`，格式见 `AI_API_价格榜_API.md §3.4`。

- `platform: official`：厂商直供价，优先级最低（官网抓取 > LiteLLM > 这里）
- `platform: official-cn`：国内站人民币原价，显示为「官方（国内站）」，优先级高于 models.dev 社区数据
- 支持阶梯价 `tiers`，单位与文件的 `unit` 相同

`verifiedAt` 超过 14 天未更新会在 status.json 中给出警告。
