/**
 * The one database seam.
 *
 * Two shells implement this interface and nothing else:
 *   - mobile: the Capacitor SQLite plugin,
 *   - desktop: node:sqlite behind Electron IPC.
 *
 * Business SQL never lives in an adapter. Repositories under
 * shared/db/repositories run through this interface, so the same statements
 * execute on every platform and only our own SQL crosses the IPC boundary.
 *
 * Every method is async because two of the three engines (Capacitor, IPC) are
 * async; the node:sqlite adapter wraps its synchronous calls.
 */
export interface DatabasePort {
  /**
   * Open the connection. Must issue `PRAGMA foreign_keys = ON` -- SQLite
   * ignores every foreign key without it, and the pragma is per connection.
   * Idempotent: a second call is a no-op.
   */
  open(): Promise<void>;

  /**
   * Run a statement, or a batch of them. Used for DDL and migrations.
   *
   * The two shells disagree about how a batch is split. node:sqlite runs the
   * whole string as a script. The Capacitor plugin splits it itself, on a
   * literal `;\n`, and strips `--` comments from each chunk -- so a batch must
   * survive that: no comment line may end in `;`, or the split lands inside a
   * comment block and the comment-only chunk prepares no statement at all.
   * `tools/verify-migration.mjs` asserts that rule.
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
