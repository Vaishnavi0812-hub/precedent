// Copies the shared matching engine into the Bitbucket companion app.
// Forge deploys each app directory on its own, so the engine is vendored, not imported across apps.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'bitbucket', 'src', 'engine');
mkdirSync(dest, { recursive: true });
for (const f of ['tokenize.js', 'match.js', 'extract.js']) {
  copyFileSync(join(root, 'src', 'engine', f), join(dest, f));
  console.log(`synced engine/${f}`);
}
