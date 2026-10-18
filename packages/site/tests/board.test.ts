import { describe, expect, it } from "vitest";
import { BOARD_TABS, boardTabSearch, parseBoardTab } from "../src/lib/board";

describe("价格榜标签（文本 / 视频 / 图像）", () => {
  it("从 ?kind= 读取标签，缺省或非法值回到文本", () => {
    expect(parseBoardTab("")).toBe("text");
    expect(parseBoardTab("?kind=video")).toBe("video");
    expect(parseBoardTab("?q=flux&kind=image")).toBe("image");
    expect(parseBoardTab("?kind=hack")).toBe("text");
    expect(BOARD_TABS).toEqual(["text", "video", "image"]);
  });

  it("切换标签时只保留搜索关键字，其他表格的筛选参数清掉", () => {
    expect(boardTabSearch("?q=gpt&vendor=openai&sort=input", "video")).toBe("?kind=video&q=gpt");
    expect(boardTabSearch("?kind=image&q=flux", "text")).toBe("?q=flux");
    expect(boardTabSearch("?kind=video", "text")).toBe("");
    expect(boardTabSearch("?q=%20%20", "image")).toBe("?kind=image");
  });
});
