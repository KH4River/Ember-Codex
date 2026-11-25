import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// `ng test` runs from angular/, so the app root is a known relative path.
const here = join(process.cwd(), 'src', 'app');

/**
 * Offline is not an exemption: the render layer never names the database.
 * A view can import the seam and still compile, so this walks the two view
 * folders instead of trusting review to catch it.
 */
const VIEW_ROOTS = ['components', 'pages'];
const FORBIDDEN = [
  /from ['"]@\/db\//,
  /from ['"]@\/shell\//,
  /\bDatabaseService\b/,
  /\bDatabasePort\b/,
];

function viewSources(root: string): string[] {
  return readdirSync(join(here, root), { withFileTypes: true }).flatMap((entry) => {
    const path = join(here, root, entry.name);
    if (entry.isDirectory()) {
      return viewSources(join(root, entry.name));
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
      return [];
    }
    return [path];
  });
}

describe('render layer boundary', () => {
  for (const root of VIEW_ROOTS) {
    it(`${root}/ does not import the database`, () => {
      const files = viewSources(root);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        for (const forbidden of FORBIDDEN) {
          expect(source, `${file} matches ${forbidden}`).not.toMatch(forbidden);
        }
      }
    });
  }
});
