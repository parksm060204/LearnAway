/* Regression tests for /api/convert convert_storage error mapping (extracted to stay below IDE 1MB inline-diff limit). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const load = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'redcall-regressions-pdf-'));

const compile = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    'app/api/convert/route.ts',
    '--rootDir',
    root,
    '--outDir',
    output,
    '--module',
    'commonjs',
    '--target',
    'ES2020',
    '--moduleResolution',
    'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
  ],
  { cwd: root, encoding: 'utf8' }
);

function createMockSupabase(user, job) {
  const jobs = [structuredClone(job)];
  const storageRemoveCalls = [];

  const findJob = (jobId, userId) => jobs.find((j) => j.job_id === jobId && j.user_id === userId) || null;

  const client = {
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getClaims: async () => ({
        data: { claims: { sub: user.id, email: 'test@example.com' } },
        error: null,
      }),
    },
    from: (table) => {
      if (table !== 'temp_pdf_conversion_jobs') {
        throw new Error(`Unexpected table: ${table}`);
      }
      const filters = {};
      let updatePayload = null;
      const chain = {
        select: () => chain,
        update: (payload) => {
          updatePayload = payload;
          return chain;
        },
        eq: (k, v) => {
          filters[k] = v;
          return chain;
        },
        in: (k, arr) => {
          filters[`__in_${k}`] = arr;
          return chain;
        },
        gt: () => chain,
        maybeSingle: async () => ({ data: findJob(filters.job_id, filters.user_id), error: null }),
        then: (resolve) => {
          if (updatePayload) {
            const matched = jobs.filter((j) => {
              if (filters.job_id && j.job_id !== filters.job_id) return false;
              if (filters.user_id && j.user_id !== filters.user_id) return false;
              if (filters.lease_token && j.lease_token !== filters.lease_token) return false;
              if (filters.status && j.status !== filters.status) return false;
              if (filters.__in_status && !filters.__in_status.includes(j.status)) return false;
              return true;
            });
            for (const j of matched) Object.assign(j, updatePayload);
            return resolve({ data: matched, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return chain;
    },
    rpc: async (name, params) => {
      const target = findJob(params.p_job_id, params.p_user_id || user.id);
      if (name === 'claim_temp_pdf_job_for_conversion') {
        if (!target) return { data: { success: false, code: 'JOB_NOT_FOUND' }, error: null };
        target.status = 'converting';
        target.lease_token = params.p_lease_token;
        return { data: { success: true, lease_token: params.p_lease_token }, error: null };
      }
      if (name === 'claim_temp_pdf_cleanup_by_converter') {
        if (!target || target.status !== 'converting' || target.lease_token !== params.p_lease_token) {
          return { data: { success: false }, error: null };
        }
        target.status = 'cleaning';
        target.lease_token = 'clean-lease';
        return { data: { success: true, cleanup_token: 'clean-lease' }, error: null };
      }
      if (name === 'finalize_temp_pdf_cleanup') {
        const j = jobs.find((item) => item.job_id === params.p_job_id);
        if (j) j.status = params.p_target_status;
        return { data: { success: true }, error: null };
      }
      return { data: null, error: { message: `Unknown RPC ${name}` } };
    },
    storage: {
      from: () => ({
        createSignedUrl: async (storagePath) => ({
          data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/materials/${storagePath}?token=signed-secret` },
          error: null,
        }),
        remove: async (paths) => {
          storageRemoveCalls.push(...paths);
          return { data: [], error: null };
        },
      }),
    },
    __jobs: jobs,
    __storageRemoveCalls: storageRemoveCalls,
  };
  return client;
}

async function run() {
  if (compile.status !== 0) {
    throw new Error(compile.stdout + compile.stderr);
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(output, 'node_modules'), 'junction');

  const { NextRequest } = load('next/server');
  const { POST: convertHandler } = load(path.join(output, 'app/api/convert/route.js'));
  const testUser = { id: 'user-pdf-convert-test' };

  const savedToken = process.env.PDF_CONVERT_SERVICE_TOKEN;
  const savedUrl = process.env.PDF_CONVERT_SERVICE_URL;
  const savedSupaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedSupaAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const savedSupaService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.PDF_CONVERT_SERVICE_TOKEN = 'test-secret-token-xyz';
  process.env.PDF_CONVERT_SERVICE_URL = 'http://127.0.0.1:54322';
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

  const originalFetch = global.fetch;
  let mockResponder = null;
  global.fetch = async (url) => {
    if (String(url).includes('54322')) return mockResponder();
    return originalFetch(url);
  };

  const makeJob = (jobId) => ({
    job_id: jobId,
    user_id: testUser.id,
    file_name: 'lecture.pdf',
    storage_path: `${testUser.id}/temp-convert/${jobId}/lecture.pdf`,
    status: 'ticket_issued',
    cleanup_attempts: 0,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });

  const runCase = async (jobId, responder, assertFn) => {
    mockResponder = responder;
    const client = createMockSupabase(testUser, makeJob(jobId));
    globalThis.__fakeSupabaseClient = client;
    try {
      const req = new NextRequest('http://localhost/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert_storage', jobId }),
      });
      const res = await convertHandler(req);
      const data = await res.json();
      assertFn(res, data, client);
    } finally {
      globalThis.__fakeSupabaseClient = undefined;
    }
  };

  try {
    // 1. 429 {"detail":"busy"} with valid Retry-After -> HTTP 429, CONVERSION_BUSY, pages:[], forwards Retry-After
    await runCase(
      'job-429',
      () => new Response(JSON.stringify({ detail: 'busy' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '15' } }),
      (res, data) => {
        assert.equal(res.status, 429);
        assert.equal(res.headers.get('retry-after'), '15');
        assert.equal(data.success, false);
        assert.equal(data.code, 'CONVERSION_BUSY');
        assert.equal(data.pageCount, 0);
        assert.deepEqual(data.pages, []);
        assert.equal(data.fullMarkdown, '');
        assert.ok(data.error.includes('잠시 후 다시 시도'));
        assert.ok(!data.error.includes('busy') && !data.error.includes('test-secret-token-xyz'));
      }
    );
    // 1B. 429 with invalid Retry-After -> must not forward invalid Retry-After
    await runCase(
      'job-429-invalid-ra',
      () => new Response(JSON.stringify({ detail: 'busy' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': 'not-a-number' } }),
      (res, data) => {
        assert.equal(res.status, 429);
        assert.equal(res.headers.get('retry-after'), null);
        assert.equal(data.code, 'CONVERSION_BUSY');
      }
    );
    console.log('PASS convert_storage 429 {"detail":"busy"} -> HTTP 429 + CONVERSION_BUSY + empty pages');

    // 2. 500 {"detail":"/internal/secret/path"} -> HTTP 502 without leaking detail/token/signedUrl
    await runCase(
      'job-500',
      () => new Response(JSON.stringify({ detail: '/internal/secret/path' }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
      (res, data) => {
        assert.equal(res.status, 502);
        assert.equal(data.success, false);
        assert.deepEqual(data.pages, []);
        assert.equal(data.pageCount, 0);
        assert.ok(!data.error.includes('/internal/secret/path') && !data.error.includes('test-secret-token-xyz') && !data.error.includes('signed-secret'));
      }
    );
    console.log('PASS convert_storage 500 -> HTTP 502 without leaking internal detail/secrets');

    // 3. Non-JSON 502 -> HTTP 502 SERVICE_RESPONSE_INVALID
    await runCase(
      'job-nonjson',
      () => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
      (res, data) => {
        assert.equal(res.status, 502);
        assert.equal(data.success, false);
        assert.equal(data.code, 'SERVICE_RESPONSE_INVALID');
        assert.deepEqual(data.pages, []);
      }
    );
    console.log('PASS convert_storage non-JSON 502 -> HTTP 502 + SERVICE_RESPONSE_INVALID');

    // 4. HTTP 200 with success:false (PDF_NO_TEXT) -> HTTP 422, pages:[]
    await runCase(
      'job-200-fail',
      () => new Response(JSON.stringify({ success: false, code: 'PDF_NO_TEXT', pageCount: 3 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      (res, data) => {
        assert.equal(res.status, 422);
        assert.equal(data.success, false);
        assert.equal(data.code, 'PDF_NO_TEXT');
        assert.deepEqual(data.pages, []);
        assert.equal(data.fullMarkdown, '');
      }
    );
    console.log('PASS convert_storage HTTP 200 success:false -> HTTP 422 + empty pages');

    // 5. Normal success -> HTTP 200, preserves pageCount & pages & cleans up temp storage
    await runCase(
      'job-ok',
      () =>
        new Response(
          JSON.stringify({
            success: true,
            pageCount: 2,
            pages: [
              { pageNumber: 1, markdown: '# 1쪽', hasText: true },
              { pageNumber: 2, markdown: '## 2쪽', hasText: true },
            ],
            fullMarkdown: '# 1쪽\n\n## 2쪽',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
      (res, data, client) => {
        assert.equal(res.status, 200);
        assert.equal(data.success, true);
        assert.equal(data.pageCount, 2);
        assert.equal(data.pages.length, 2);
        assert.equal(data.fullMarkdown, '# 1쪽\n\n## 2쪽');
        assert.equal(client.__storageRemoveCalls.length, 1);
        assert.equal(client.__jobs[0].status, 'cleaned');
      }
    );
    console.log('PASS convert_storage 200 success -> HTTP 200 + 2 pages + temp storage cleaned');
  } finally {
    global.fetch = originalFetch;
    if (savedToken === undefined) delete process.env.PDF_CONVERT_SERVICE_TOKEN;
    else process.env.PDF_CONVERT_SERVICE_TOKEN = savedToken;
    if (savedUrl === undefined) delete process.env.PDF_CONVERT_SERVICE_URL;
    else process.env.PDF_CONVERT_SERVICE_URL = savedUrl;
    if (savedSupaUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = savedSupaUrl;
    if (savedSupaAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedSupaAnon;
    if (savedSupaService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedSupaService;
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(output, { recursive: true, force: true }));

