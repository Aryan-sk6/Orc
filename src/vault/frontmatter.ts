/**
 * Minimal YAML frontmatter for orc-owned notes: flat `key: scalar` pairs only.
 * Strings are written JSON-quoted (valid YAML); unquoted hand edits are read back as strings.
 * Lines that are not `key: value` (lists, comments, nested maps) are ignored on read.
 */

export type FrontmatterValue = string | number | boolean | null;

export type FrontmatterData = Readonly<Record<string, FrontmatterValue>>;

export interface ParsedNote {
  readonly data: FrontmatterData;
  readonly body: string;
}

const FENCE = "---";
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

export function parseFrontmatter(text: string): ParsedNote {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== FENCE) {
    return { data: {}, body: text };
  }
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) {
    return { data: {}, body: text };
  }

  const data: Record<string, FrontmatterValue> = {};
  for (const line of lines.slice(1, end)) {
    const match = KEY_LINE.exec(line);
    const key = match?.[1];
    const raw = match?.[2];
    if (key !== undefined && raw !== undefined) {
      data[key] = parseScalar(raw.trim());
    }
  }
  return { data, body: lines.slice(end + 1).join("\n") };
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  const lines = Object.entries(data).map(([key, value]) => `${key}: ${serializeScalar(value)}`);
  return `${FENCE}\n${lines.join("\n")}\n${FENCE}\n${body}`;
}

function parseScalar(raw: string): FrontmatterValue {
  if (raw === "" || raw === "null" || raw === "~") {
    return null;
  }
  if (raw === "true" || raw === "false") {
    return raw === "true";
  }
  if (NUMBER.test(raw)) {
    return Number(raw);
  }
  if (raw.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "string") {
        return parsed;
      }
    } catch {
      // Not valid JSON: fall through and keep the raw text.
    }
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  return raw;
}

function serializeScalar(value: FrontmatterValue): string {
  if (value === null) {
    return "null";
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
