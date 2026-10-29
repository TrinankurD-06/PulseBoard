// Builds dist/: one ESM file, one CommonJS file and the type definitions.
// Run with `npm run build`; `prepublishOnly` and the tests call it too.
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const bundle = await rolldown({
  input: join(root, 'src', 'index.js'),
  external: [/^node:/],
  platform: 'node',
});
await bundle.write({ file: join(dist, 'index.js'), format: 'esm' });
await bundle.write({ file: join(dist, 'index.cjs'), format: 'cjs', exports: 'named' });
await bundle.close();

// The same declarations serve both module systems (.d.ts for import, .d.cts for require).
await copyFile(join(root, 'types', 'index.d.ts'), join(dist, 'index.d.ts'));
await copyFile(join(root, 'types', 'index.d.ts'), join(dist, 'index.d.cts'));
