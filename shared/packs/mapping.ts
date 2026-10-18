/**
 * JSON is camelCase, columns are snake_case. Almost every column is the
 * mechanical transform of its own name, so this holds the exceptions rather
 * than a transcription of every column -- a transcription that size can drop
 * one silently, and a dropped column is invisible in the exported file.
 */

/** Never crosses the file; the value says which and why. */
const DROPPED_COLUMNS: Readonly<Record<string, string>> = {
  id: 'the row id belongs to this database only',
  source_id: 'pack identity is source.key',
  imported_at: 'records when this user imported the pack',
};

/** Where the mechanical transform is wrong. `slug` is `key` because KEY is
 *  reserved in MySQL and a keyword in SQLite. */
const RENAMED_COLUMNS: Readonly<Record<string, string>> = {
  slug: 'key',
  spellcasting_ability_id: 'spellcastingAbility',
};

/** hp_max -> hpMax */
function toCamelCase(column: string): string {
  return column.replace(/_+([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function toSnakeCase(jsonName: string): string {
  return jsonName.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/** The inverse, built from the same declaration so the two cannot disagree. */
const COLUMN_FOR_JSON_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(RENAMED_COLUMNS).map(([column, jsonName]) => [jsonName, column]),
);

export function isDropped(column: string): boolean {
  return Object.hasOwn(DROPPED_COLUMNS, column);
}

/** Why a column is dropped, for a comment or an error message. */
export function reasonDropped(column: string): string | undefined {
  return DROPPED_COLUMNS[column];
}

/** The JSON name for a column, or undefined when the column is dropped. */
export function jsonNameFor(column: string): string | undefined {
  if (isDropped(column)) return undefined;
  const renamed = Object.hasOwn(RENAMED_COLUMNS, column) ? RENAMED_COLUMNS[column] : undefined;
  if (renamed !== undefined) return renamed;
  return toCamelCase(column);
}

/** The column a JSON name maps to. A dropped column stays dropped, or a file
 *  carrying "id" would be handed to an INSERT and set a row id. */
export function columnFor(jsonName: string): string | undefined {
  const renamed = COLUMN_FOR_JSON_NAME.get(jsonName);
  if (renamed !== undefined) return renamed;
  const column = toSnakeCase(jsonName);
  if (isDropped(column)) return undefined;
  return column;
}

export function jsonNamesFor(columns: readonly string[]): string[] {
  const names: string[] = [];
  for (const column of columns) {
    const jsonName = jsonNameFor(column);
    if (jsonName !== undefined) names.push(jsonName);
  }
  return names;
}

/** The columns a JSON object names, keeping only those the table has. The
 *  transform runs both ways, so any string converts to something and only the
 *  table can tell a typo from a column. */
export function columnsFor(
  json: Readonly<Record<string, unknown>>,
  tableColumns: readonly string[],
): string[] {
  const columns: string[] = [];
  for (const jsonName of Object.keys(json)) {
    const column = columnFor(jsonName);
    if (column !== undefined && tableColumns.includes(column)) columns.push(column);
  }
  return columns;
}