/**
 * 站外跳转页 /go/<key>/：用户点「官网」先到站内跳转页，1 秒后去目标网站。
 * Cloudflare Web Analytics 只统计页面访问、没有自定义事件，所以把一次点击记成一次 /go/<key>/ 访问；
 * 以后接推广链接时，也只需要在这里换目标地址（DEV §3.26）。
 * - 官方报价（official / official-cn）按厂商：v-<vendor>，跳到厂商定价页，没有就跳官网
 * - 第三方平台按平台：p-<platform>，跳到平台定价页，没有就跳官网
 */
import type { SiteModel } from "./site-model";
import { joinBase } from "./url";

export interface GoTarget {
  readonly key: string;
  readonly url: string;
  readonly nameZh: string;
  readonly nameEn: string;
}

interface OfferingRef {
  readonly platform: string;
  readonly vendor: string;
}

const isOfficial = (platform: string): boolean => platform.startsWith("official");

export function goKey(o: OfferingRef): string {
  return isOfficial(o.platform) ? `v-${o.vendor}` : `p-${o.platform}`;
}

export function goTargets(model: SiteModel): readonly GoTarget[] {
  const vendors = [...model.vendors.values()].map((v) => ({
    key: `v-${v.id}`,
    url: v.pricingUrl ?? v.website,
    nameZh: v.nameZh,
    nameEn: v.nameEn,
  }));
  const platforms = [...model.platforms.values()]
    .filter((p) => !isOfficial(p.id) && p.category !== "official")
    .flatMap((p) => {
      const url = p.pricingUrl ?? p.website;
      return url ? [{ key: `p-${p.id}`, url, nameZh: p.nameZh, nameEn: p.nameEn }] : [];
    });
  return [...vendors, ...platforms];
}

/** 有跳转目标时返回站内路径（含 base），否则 null（页面上就不显示「官网」链接） */
export function goHref(model: SiteModel, base: string, o: OfferingRef): string | null {
  const key = goKey(o);
  return goTargets(model).some((t) => t.key === key) ? joinBase(base, `go/${key}/`) : null;
}
