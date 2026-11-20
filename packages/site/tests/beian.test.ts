import { describe, expect, it } from "vitest";
import { BEIAN_URL, icpBeian } from "../src/lib/seo";

describe("ICP 备案号（国内站页脚）", () => {
  it("ICP_BEIAN 设置了合法的备案号才显示，链接到工信部备案系统", () => {
    expect(icpBeian({ ICP_BEIAN: " 豫ICP备2026013506号-1 " })).toEqual({
      text: "豫ICP备2026013506号-1",
      url: BEIAN_URL,
    });
    expect(BEIAN_URL).toBe("https://beian.miit.gov.cn/");
  });

  it("没设置或格式不对时不显示（海外镜像 GitHub Pages 不设置）", () => {
    expect(icpBeian({})).toBeNull();
    expect(icpBeian({ ICP_BEIAN: "" })).toBeNull();
    expect(icpBeian({ ICP_BEIAN: "<script>" })).toBeNull();
    expect(icpBeian({ ICP_BEIAN: "ICP 12345" })).toBeNull();
  });
});
