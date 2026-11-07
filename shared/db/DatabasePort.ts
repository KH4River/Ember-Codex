/**
 * One database seam for the two shells: Capacitor SQLite on mobile and
 * node:sqlite behind Electron IPC on desktop. Business SQL stays in
 * shared/db/repositories; adapters only carry it. Methods are async because both
 * shells are; node:sqlite wraps sync calls.
 */
export interface DatabasePort {
  /**
   * Open the connection. Must issue `PRAGMA foreign_keys = ON` -- SQLite
   * ignores every foreign key without it, and the pragma is per connection.
   * Idempotent: a second call is a no-op.
   */
  open(): Promise<void>;

  /**
   * Run a statement or batch. node:sqlite runs the whole string as a script; the
   * Capacitor plugin splits it on a literal `;\n` and strips `--` comments from
   * each chunk. A comment line ending in `;` can leave an empty chunk that
   * prepares no statement, so keep comment lines free of trailing semicolons. The
   * harness asserts that rule.
   */
  exec(sql: string): Promise<void>;

  /** Run one parameterised statement (INSERT/UPDATE/DELETE). */
  run(sql: string, params?: readonly unknown[]): Promise<void>;

  /** Run a parameterised query and return every row. */
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;

  /** Run a parameterised query and return the first row, if any. */
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;

  /** Close the connection. */
  close(): Promise<void>;
}
