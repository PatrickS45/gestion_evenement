// Installation et lancement du serveur PocketBase (version figée, archive vérifiée).
//   node scripts/pocketbase.mjs install   télécharge le binaire dans server/bin
//   node scripts/pocketbase.mjs serve     compile les hooks puis lance le serveur sur le port 8090
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { buildHooks } from './build-hooks.mjs';

export const PB_VERSION = '0.40.4';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const serverDir = join(root, 'server');
export const binary = join(serverDir, 'bin', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');

function platformAsset() {
  const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!os || !arch) throw new Error(`Plateforme non prise en charge : ${process.platform}/${process.arch}`);
  return `pocketbase_${PB_VERSION}_${os}_${arch}.zip`;
}

export async function install() {
  if (existsSync(binary)) return;
  const asset = platformAsset();
  const base = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}`;
  console.log(`Téléchargement de PocketBase ${PB_VERSION} (${asset})…`);
  const [zip, sums] = await Promise.all([
    fetch(`${base}/${asset}`).then((r) => { if (!r.ok) throw new Error(`${asset} : HTTP ${r.status}`); return r.arrayBuffer(); }),
    fetch(`${base}/checksums.txt`).then((r) => { if (!r.ok) throw new Error(`checksums.txt : HTTP ${r.status}`); return r.text(); }),
  ]);
  const expected = sums.split('\n').find((l) => l.trim().endsWith(asset))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(Buffer.from(zip)).digest('hex');
  if (!expected || expected !== actual) throw new Error(`Somme de contrôle invalide pour ${asset}`);
  const name = binary.split(/[\\/]/).pop();
  const content = unzipSync(new Uint8Array(zip), { filter: (f) => f.name === name })[name];
  if (!content) throw new Error(`${name} absent de l'archive`);
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, content);
  if (process.platform !== 'win32') chmodSync(binary, 0o755);
  console.log(`PocketBase installé : ${binary}`);
}

/** Arguments communs : dossiers de données, de hooks et de migrations du projet. */
export function serverArgs(dataDir = join(serverDir, 'pb_data')) {
  return [
    `--dir=${dataDir}`,
    `--hooksDir=${join(serverDir, 'pb_hooks')}`,
    `--migrationsDir=${join(serverDir, 'pb_migrations')}`,
  ];
}

async function serve(extra) {
  await install();
  await buildHooks();
  const child = spawn(binary, ['serve', ...serverArgs(), '--dev', ...extra], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...rest] = process.argv.slice(2);
  const run = command === 'install' ? install() : command === 'serve' ? serve(rest) : null;
  if (!run) { console.error('Usage : node scripts/pocketbase.mjs install|serve'); process.exit(1); }
  run.catch((err) => { console.error(err.message); process.exit(1); });
}
