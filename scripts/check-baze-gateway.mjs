/* Check the BAZE API Gateway key and model entitlement.
 *
 *   node scripts/check-baze-gateway.mjs
 *
 * Reads BAZE_API_KEY / BAZE_BASE_URL / BAZE_MODEL from .env.local, .env or the
 * process environment. NEVER prints the key. This is a read-only probe: it does
 * NOT call any paid generation endpoint.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'https://factchat-cloud.mindlogic.ai/v1/gateway';
const DEFAULT_MODEL = 'deepseek-v4.1-flash';

function loadEnv() {
  const env = {};
  for (const file of ['.env.local', '.env']) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };
const key = (env.BAZE_API_KEY || '').trim();
const base = (env.BAZE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
const model = (env.BAZE_MODEL || DEFAULT_MODEL).trim();

if (!key || /your_|placeholder/i.test(key)) {
  console.log('BAZE: NOT CONFIGURED (BAZE_API_KEY is missing)');
  console.log('Set AI_PROVIDER=school_gateway and BAZE_API_KEY in the server environment, then re-run.');
  process.exit(0);
}

const sanitize = (text) => {
  let out = String(text || '').slice(0, 400);
  if (key) out = out.split(key).join('[redacted]');
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]');
};

const url = `${base}/models/?type=llm`;
console.log(`BAZE: probing ${url} (key length=${key.length}, host=${new URL(base).host})`);

let response;
try {
  response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'LearnAway/1.0', Accept: 'application/json' },
  });
} catch (err) {
  console.log(`BAZE: NETWORK ERROR -> ${sanitize(err instanceof Error ? err.message : err)}`);
  process.exit(1);
}

if (!response.ok) {
  const body = sanitize(await response.text().catch(() => ''));
  if (response.status === 401) {
    console.log('BAZE: AUTH FAILED (401) — key is invalid or belongs to a different deployment than factchat-cloud.');
  } else if (response.status === 403) {
    console.log('BAZE: FORBIDDEN (403) — not necessarily a bad key: the model may be disabled for the org,');
    console.log('      an excluded model, or the request was blocked before the gateway (Cloudflare requires a User-Agent).');
  } else if (response.status === 402) {
    console.log('BAZE: CREDIT EXHAUSTED (402) — top up the BAZE account.');
  } else if (response.status === 429) {
    console.log(`BAZE: RATE LIMITED (429) — retry after ${response.headers.get('retry-after') ?? 'a while'}.`);
  } else {
    console.log(`BAZE: FAILED (HTTP ${response.status}) -> ${body}`);
  }
  process.exit(1);
}

const payload = await response.json().catch(() => null);
const ids = Array.isArray(payload?.data) ? payload.data.map((m) => m?.id).filter(Boolean) : [];
const hasModel = ids.includes(model);
console.log(`BAZE: OK (HTTP 200) — ${ids.length} llm model(s) visible`);
console.log(`BAZE: model '${model}' ${hasModel ? 'IS AVAILABLE' : 'is NOT in the list'}`);
if (!hasModel) {
  console.log(`BAZE: visible models: ${ids.slice(0, 30).join(', ')}${ids.length > 30 ? ', ...' : ''}`);
}
process.exit(hasModel ? 0 : 2);
