import { expect, test } from "@playwright/test";
import { validateEnvelope, type EndpointKind } from "../../src/lib/api-validate";

const ENDPOINTS: readonly [string, EndpointKind][] = [
  ["/api/v1/latest.json", "latest"],
  ["/api/v1/providers.json", "providers"],
  ["/api/v1/models/deepseek/deepseek-chat.json", "model"],
  ["/api/v1/models/cohere/command-r-plus.json", "model"],
  ["/api/v1/changes.json", "changes"],
  ["/api/v1/changes/2026-10.json", "changes"],
  ["/api/v1/changes/index.json", "changesIndex"],
  ["/api/v1/fx.json", "fx"],
  ["/api/v1/status.json", "status"],
];

test.describe("公开接口", () => {
  for (const [path, kind] of ENDPOINTS) {
    test(`${path} 通过 schema 校验`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      expect(validateEnvelope(kind, await res.json())).toEqual([]);
    });
  }

  test("latest.json 不包含已下架的报价", async ({ request }) => {
    const body = await (await request.get("/api/v1/latest.json")).json();
    const ids = body.data.offerings.map((o: { id: string }) => o.id);
    expect(ids).not.toContain("official:cohere/command-r-plus");
    expect(body.meta.count).toBe(ids.length);
  });

  for (const path of ["/rss.xml", "/en/rss.xml", "/sitemap.xml"]) {
    test(`${path} 是合法的 XML`, async ({ page, request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const xml = await res.text();
      await page.goto("/");
      const result = await page.evaluate((text) => {
        const doc = new DOMParser().parseFromString(text, "application/xml");
        return {
          error: doc.querySelector("parsererror")?.textContent ?? null,
          items: doc.querySelectorAll("item").length,
        };
      }, xml);
      expect(result.error).toBeNull();
      if (path.includes("rss")) {
        expect(result.items).toBeGreaterThan(0);
        expect(xml).not.toContain("<category>context_change</category>");
        expect(xml).toContain("&lt;Instruct&gt; &amp;");
      }
    });
  }
});
