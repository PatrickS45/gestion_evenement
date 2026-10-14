// Compile la logique serveur (server/src, qui réutilise src/domain) en un module CommonJS
// ES2015 chargé par les hooks PocketBase : server/pb_hooks/lib/ec.cjs.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildHooks() {
  await build({
    input: join(root, 'server/src/index.ts'),
    platform: 'neutral',
    transform: { target: 'es2015' },
    output: {
      file: join(root, 'server/pb_hooks/lib/ec.cjs'),
      format: 'cjs',
      banner: '// Fichier généré par scripts/build-hooks.mjs à partir de server/src : ne pas modifier.',
    },
    logLevel: 'warn',
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildHooks().then(() => console.log('Hooks compilés : server/pb_hooks/lib/ec.cjs'), (err) => { console.error(err); process.exit(1); });
}
