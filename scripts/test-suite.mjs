/* Runs the full in-app verification suite (lib/testSuite.ts) in Node.
 *
 * The suite is normally executed in the browser; this runner provides the
 * minimal window/localStorage shims so CI can run it headlessly. It compiles
 * the TypeScript to a temp dir and requires the compiled module (which runs the
 * tests on import).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const load = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learnaway-suite-'));

const compile = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    'lib/testSuite.ts',
    '--outDir', output,
    '--rootDir', root,
    '--module', 'commonjs',
    '--target', 'ES2020',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
  ],
  { cwd: root, encoding: 'utf8' }
);

if (compile.status !== 0) {
  console.error(compile.stdout + compile.stderr);
  process.exitCode = 1;
} else {
  const data = new Map();
  global.window = { localStorage: {} };
  global.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => { data.clear(); },
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  };
  window.localStorage = localStorage;

  try {
    load(path.join(output, 'lib', 'testSuite.js'));
    // The suite is asynchronous; give pending microtasks/dispatches time to run.
    setTimeout(() => {
      console.log('\n[test-suite] finished');
      fs.rmSync(output, { recursive: true, force: true });
    }, 500);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    fs.rmSync(output, { recursive: true, force: true });
  }
}
