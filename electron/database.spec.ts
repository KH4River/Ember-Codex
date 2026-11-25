import { GameDatabase } from './database';

/**
 * GameDatabase is the Electron main-process wrapper. It has no Electron
 * imports, so it runs under plain Node -- which is the only way to test it in
 * an environment where the Electron binary is unavailable.
 */
describe('GameDatabase (Electron main process)', () => {
  let db: GameDatabase;

  beforeEach(() => {
    db = new GameDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('issues PRAGMA foreign_keys = ON for the connection', () => {
    const row = db.get('PRAGMA foreign_keys') as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  it('reports a SQLite version new enough for STRICT tables (>= 3.37)', () => {
    const [major, minor] = db.sqliteVersion().split('.').map(Number);
    expect(major > 3 || (major === 3 && minor >= 37)).toBe(true);
  });

  it('executes DDL and parameterised statements', () => {
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT');
    db.run('INSERT INTO t (name) VALUES (?)', ['Elf']);
    expect(db.all('SELECT id, name FROM t')).toEqual([{ id: 1, name: 'Elf' }]);
    expect(db.get('SELECT name FROM t WHERE id = ?', [1])).toEqual({ name: 'Elf' });
  });

  it('enforces foreign keys, so the pragma is doing real work', () => {
    db.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent (id)) STRICT;
    `);
    expect(() => db.run('INSERT INTO child (parent_id) VALUES (?)', [999])).toThrow();
  });
});
