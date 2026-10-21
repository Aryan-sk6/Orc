export interface Column {
  readonly header: string;
  readonly align?: "left" | "right";
  /** Longer cells are cut to this width and end in "…". */
  readonly maxWidth?: number;
}

const GAP = "  ";

/** Plain-text table: a header row, then one row per entry, columns padded to fit. */
export function renderTable(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
): string {
  const cells = rows.map((row) =>
    columns.map((column, index) => truncate(row[index] ?? "", column.maxWidth)),
  );
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((row) => row[index]?.length ?? 0)),
  );
  const line = (values: readonly string[]): string =>
    columns
      .map((column, index) => {
        const value = values[index] ?? "";
        const width = widths[index] ?? value.length;
        return column.align === "right" ? value.padStart(width) : value.padEnd(width);
      })
      .join(GAP)
      .trimEnd();

  return [line(columns.map((column) => column.header)), ...cells.map(line)].join("\n");
}

function truncate(value: string, maxWidth: number | undefined): string {
  if (maxWidth === undefined || value.length <= maxWidth) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxWidth - 1))}…`;
}
