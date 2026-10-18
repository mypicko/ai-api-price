/**
 * 校验公开接口的输出（构建产物检查和 E2E 测试共用）。
 * site 不直接依赖 zod，所以这里用 shared 里的 schema 校验各个部分，外层结构手动检查。
 */
import {
  ChangeEventSchema,
  FxRateSchema,
  OfferingSchema,
  PricePointSchema,
  PriceSetSchema,
  QuarantineEntrySchema,
  RunSummarySchema,
  SourceResultSchema,
  WarningSchema,
} from "@aipb/shared";
import { formatIssues, type IssueLike } from "./data-errors";

interface Parser {
  safeParse(input: unknown): { success: boolean; error?: { issues: readonly IssueLike[] } };
}

export type EndpointKind =
  "latest" | "providers" | "model" | "changes" | "changesIndex" | "fx" | "status";

const PublicOfferingBase = OfferingSchema.omit({
  modalities: true,
  missingDays: true,
  firstSeenAt: true,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function check(errors: string[], path: string, schema: Parser, value: unknown): void {
  const result = schema.safeParse(value);
  if (!result.success) errors.push(`${path}\n${formatIssues(result.error?.issues ?? [])}`);
}

function expect(errors: string[], condition: boolean, message: string): void {
  if (!condition) errors.push(message);
}

function isNullableNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function checkOffering(errors: string[], path: string, value: unknown): void {
  if (!isRecord(value)) return void errors.push(`${path}: 不是对象`);
  const { converted, blended, change7d, ...rest } = value;
  check(errors, path, PublicOfferingBase.strict(), rest);
  expect(
    errors,
    value["status"] !== "removed" || path.includes("model"),
    `${path}: 公开列表不应包含 removed`,
  );
  if (!isRecord(converted)) return void errors.push(`${path}.converted: 缺失`);
  check(errors, `${path}.converted.usd`, PriceSetSchema.strict(), converted["usd"]);
  check(errors, `${path}.converted.cny`, PriceSetSchema.strict(), converted["cny"]);
  expect(
    errors,
    blended === null ||
      (isRecord(blended) && isNullableNumber(blended["usd"]) && isNullableNumber(blended["cny"])),
    `${path}.blended: 格式错误`,
  );
  expect(
    errors,
    change7d === null ||
      (isRecord(change7d) &&
        isNullableNumber(change7d["input"]) &&
        isNullableNumber(change7d["output"])),
    `${path}.change7d: 格式错误`,
  );
}

function checkArray(
  errors: string[],
  path: string,
  value: unknown,
  item: (path: string, v: unknown) => void,
): void {
  if (!Array.isArray(value)) return void errors.push(`${path}: 不是数组`);
  value.forEach((v, i) => item(`${path}[${i}]`, v));
}

function checkData(errors: string[], kind: EndpointKind, data: Record<string, unknown>): void {
  const schemaItem = (schema: Parser) => (path: string, v: unknown) =>
    check(errors, path, schema, v);
  switch (kind) {
    case "latest":
      return checkArray(errors, "data.offerings", data["offerings"], (p, v) =>
        checkOffering(errors, p, v),
      );
    case "providers":
      checkArray(errors, "data.vendors", data["vendors"], (p, v) =>
        expect(
          errors,
          isRecord(v) && typeof v["id"] === "string" && typeof v["modelCount"] === "number",
          `${p}: 格式错误`,
        ),
      );
      return checkArray(errors, "data.platforms", data["platforms"], (p, v) =>
        expect(errors, isRecord(v) && typeof v["id"] === "string", `${p}: 格式错误`),
      );
    case "model":
      expect(
        errors,
        isRecord(data["model"]) && typeof data["model"]["slug"] === "string",
        "data.model: 格式错误",
      );
      checkArray(errors, "data.model.offerings", data["offerings"], (p, v) =>
        checkOffering(errors, p, v),
      );
      checkArray(errors, "data.changes", data["changes"], schemaItem(ChangeEventSchema));
      if (!isRecord(data["history"])) return void errors.push("data.history: 不是对象");
      return Object.entries(data["history"]).forEach(([id, series]) =>
        checkArray(errors, `data.history.${id}`, series, schemaItem(PricePointSchema)),
      );
    case "changes":
      return checkArray(errors, "data.events", data["events"], schemaItem(ChangeEventSchema));
    case "changesIndex":
      return checkArray(errors, "data.months", data["months"], (p, v) =>
        expect(errors, typeof v === "string" && /^\d{4}-\d{2}$/.test(v), `${p}: 月份格式错误`),
      );
    case "fx":
      check(errors, "data.latest", FxRateSchema, data["latest"]);
      return checkArray(errors, "data.history", data["history"], schemaItem(FxRateSchema));
    case "status":
      if (data["run"] !== null) check(errors, "data.run", RunSummarySchema, data["run"]);
      checkArray(errors, "data.sources", data["sources"], schemaItem(SourceResultSchema));
      checkArray(errors, "data.quarantine", data["quarantine"], schemaItem(QuarantineEntrySchema));
      return checkArray(errors, "data.warnings", data["warnings"], schemaItem(WarningSchema));
  }
}

/** 返回错误列表；空数组表示通过 */
export function validateEnvelope(kind: EndpointKind, body: unknown): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(body)) return ["根节点不是对象"];
  expect(errors, body["success"] === true, "success 必须为 true");
  expect(errors, body["error"] === null, "error 必须为 null");
  const meta = body["meta"];
  expect(
    errors,
    isRecord(meta) &&
      typeof meta["schemaVersion"] === "string" &&
      typeof meta["generatedAt"] === "string" &&
      typeof meta["dataDate"] === "string",
    "meta 缺少 schemaVersion / generatedAt / dataDate",
  );
  const data = body["data"];
  if (!isRecord(data)) return [...errors, "data 不是对象"];
  checkData(errors, kind, data);
  if (isRecord(meta) && "count" in meta) {
    const list =
      data["offerings"] ?? data["events"] ?? data["vendors"] ?? data["months"] ?? data["history"];
    expect(
      errors,
      !Array.isArray(list) || list.length === meta["count"],
      "meta.count 与条目数不一致",
    );
  }
  return errors;
}
