/**
 * 极简 XML 构建器（安全项 S7）：所有文本和属性值都在序列化时统一转义，
 * 调用方只构建节点树，不手动拼接 XML 字符串。
 */
export interface XmlElement {
  readonly name: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: readonly XmlNode[];
}
export type XmlNode = XmlElement | string;

const NAME_PATTERN = /^[A-Za-z_][\w.:-]*$/;
// XML 1.0 不允许的控制字符
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(text: string): string {
  return text
    .replace(INVALID_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function el(
  name: string,
  attrs: Readonly<Record<string, string>> = {},
  children: readonly XmlNode[] = [],
): XmlElement {
  if (!NAME_PATTERN.test(name)) throw new Error(`非法的 XML 元素名：${name}`);
  return { name, attrs, children };
}

/** 只有文本内容的元素 */
export function textEl(
  name: string,
  text: string,
  attrs: Readonly<Record<string, string>> = {},
): XmlElement {
  return el(name, attrs, [text]);
}

function serializeAttrs(attrs: Readonly<Record<string, string>>): string {
  return Object.entries(attrs)
    .map(([key, value]) => {
      if (!NAME_PATTERN.test(key)) throw new Error(`非法的 XML 属性名：${key}`);
      return ` ${key}="${escapeXml(value)}"`;
    })
    .join("");
}

export function serializeXml(node: XmlNode, indent = ""): string {
  if (typeof node === "string") return escapeXml(node);
  const attrs = serializeAttrs(node.attrs ?? {});
  const children = node.children ?? [];
  if (children.length === 0) return `${indent}<${node.name}${attrs}/>`;
  if (children.every((c) => typeof c === "string")) {
    return `${indent}<${node.name}${attrs}>${children.map((c) => serializeXml(c)).join("")}</${node.name}>`;
  }
  const inner = children.map((c) =>
    typeof c === "string" ? `${indent}  ${escapeXml(c)}` : serializeXml(c, `${indent}  `),
  );
  return `${indent}<${node.name}${attrs}>\n${inner.join("\n")}\n${indent}</${node.name}>`;
}

export function xmlDocument(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializeXml(root)}\n`;
}
