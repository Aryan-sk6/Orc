/**
 * Minimal dotenv reader for presence checks: `KEY=value`, optional `export ` prefix,
 * `#` comments, single or double quotes. No interpolation and no multi-line values;
 * orc only needs to know whether a variable has a non-empty value.
 */
export function parseEnvFile(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const key = match?.[1];
    const raw = match?.[2];
    if (key === undefined || raw === undefined) {
      continue;
    }
    vars.set(key, unquote(raw));
  }
  return vars;
}

function unquote(raw: string): string {
  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.length >= 2) {
    const end = raw.indexOf(quote, 1);
    if (end !== -1) {
      return raw.slice(1, end);
    }
  }
  // Unquoted: an inline comment starts at " #".
  const comment = raw.search(/\s#/);
  return (comment === -1 ? raw : raw.slice(0, comment)).trim();
}
