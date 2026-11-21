import { describe, expect, it } from "vitest";
import { canonicalSite } from "../src/lib/seo";

const BUILD = { origin: "https://mypicko.github.io", base: "/ai-api-price/" };

describe("canonical 主站（海外镜像指向国内主站，DEV §3.28）", () => {
  it("没设置 CANONICAL_URL 时用本站自己的域名和 base", () => {
    expect(canonicalSite({}, BUILD)).toEqual(BUILD);
    expect(canonicalSite({ CANONICAL_URL: "" }, BUILD)).toEqual(BUILD);
  });

  it("设置后改用主站的域名和路径（主站 base 与镜像不同）", () => {
    expect(canonicalSite({ CANONICAL_URL: " https://promptso.top " }, BUILD)).toEqual({
      origin: "https://promptso.top",
      base: "/",
    });
    expect(canonicalSite({ CANONICAL_URL: "https://example.com/price" }, BUILD)).toEqual({
      origin: "https://example.com",
      base: "/price/",
    });
  });

  it("只接受 https 地址，格式不对时忽略", () => {
    expect(canonicalSite({ CANONICAL_URL: "http://promptso.top" }, BUILD)).toEqual(BUILD);
    expect(canonicalSite({ CANONICAL_URL: "promptso.top" }, BUILD)).toEqual(BUILD);
    expect(canonicalSite({ CANONICAL_URL: "javascript:alert(1)" }, BUILD)).toEqual(BUILD);
  });
});
