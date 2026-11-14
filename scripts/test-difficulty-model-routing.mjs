import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'learnaway-manual-model-'));
const load = createRequire(import.meta.url);

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}`, err);
  }
}

try {
  const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const compile = spawnSync(
    process.execPath,
    [
      tscBin,
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--target', 'es2022',
      '--esModuleInterop',
      '--strictNullChecks',
      '--skipLibCheck',
      '--rootDir', root,
      '--outDir', output,
      path.join(root, 'lib', 'aiModelPolicy.ts'),
      path.join(root, 'lib', 'aiModelSelectionClient.ts'),
      path.join(root, 'lib', 'aiClient.ts'),
      path.join(root, 'lib', 'aiCostTelemetry.ts'),
      path.join(root, 'lib', 'aiCredentials.ts'),
      path.join(root, 'app', 'api', 'ai-connection', 'route.ts'),
      path.join(root, 'app', 'api', 'generate-problems', 'route.ts'),
      path.join(root, 'app', 'api', 'transfer-problem', 'route.ts'),
      path.join(root, 'app', 'api', 'review-problem-quality', 'route.ts'),
      path.join(root, 'app', 'api', 'logic-questions', 'route.ts'),
      path.join(root, 'app', 'api', 'evaluate-answer', 'route.ts'),
    ],
    { cwd: root, encoding: 'utf8' }
  );

  if (compile.status !== 0) {
    console.error(compile.stdout, compile.stderr);
    process.exit(1);
  }

  const rootRequire = createRequire(path.join(root, 'package.json'));
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'next/headers') {
      return { cookies: async () => ({ getAll: () => [], set: () => {} }) };
    }
    if (request.startsWith('@/')) {
      const mapped = path.join(output, request.slice(2));
      return origLoad.call(this, mapped, parent, isMain);
    }
    try {
      return origLoad.call(this, request, parent, isMain);
    } catch (err) {
      if (!request.startsWith('.') && !path.isAbsolute(request)) {
        return rootRequire(request);
      }
      throw err;
    }
  };

  const policy = load(path.join(output, 'lib', 'aiModelPolicy.js'));
  const aiClient = load(path.join(output, 'lib', 'aiClient.js'));
  const telemetry = load(path.join(output, 'lib', 'aiCostTelemetry.js'));
  const aiCreds = load(path.join(output, 'lib', 'aiCredentials.js'));
  const aiConfigMod = load(path.join(output, 'lib', 'aiConfig.js'));
  const supabaseServerMod = load(path.join(output, 'lib', 'supabase', 'server.js'));
  const supabaseAdminMod = load(path.join(output, 'lib', 'supabase', 'admin.js'));
  const apiAuthMod = load(path.join(output, 'lib', 'auth', 'apiAuth.js'));
  const recoveryTokenMod = load(path.join(output, 'lib', 'recoveryToken.js'));
  const markdownUtilsMod = load(path.join(output, 'lib', 'markdownUtils.js'));

  const aiConnectionRoute = load(path.join(output, 'app', 'api', 'ai-connection', 'route.js'));
  const transferRoute = load(path.join(output, 'app', 'api', 'transfer-problem', 'route.js'));
  const reviewRoute = load(path.join(output, 'app', 'api', 'review-problem-quality', 'route.js'));
  const logicRoute = load(path.join(output, 'app', 'api', 'logic-questions', 'route.js'));
  const evalRoute = load(path.join(output, 'app', 'api', 'evaluate-answer', 'route.js'));
  const genRoute = load(path.join(output, 'app', 'api', 'generate-problems', 'route.js'));

  const schoolBaseConfig = {
    provider: 'school_gateway',
    apiKey: 'baze-test-key',
    model: 'deepseek-v4.1-flash',
    apiBase: 'https://factchat-cloud.mindlogic.ai/v1/gateway',
    minOutputTokens: 16000,
    jsonMode: 'json_object',
  };

  await check('1. selectAiConfigForManualModel respects explicit DeepSeek/Sonnet and isolates model options', async () => {
    const sonnetRes = policy.selectAiConfigForManualModel({
      baseConfig: schoolBaseConfig,
      requestedModel: 'claude-sonnet-5-5',
    });
    assert.equal(sonnetRes.ok, true);
    assert.equal(sonnetRes.config.model, 'claude-sonnet-5-5');
    assert.equal(sonnetRes.config.minOutputTokens, 0);
    assert.equal(sonnetRes.config.jsonMode, 'none');

    const savedSonnetBase = aiCreds.buildSchoolConfig('baze-test-key', 'claude-sonnet-5-5');
    assert.equal(savedSonnetBase.model, 'claude-sonnet-5-5');
    assert.equal(savedSonnetBase.minOutputTokens, 0);
    assert.equal(savedSonnetBase.jsonMode, 'none');

    const deepseekOverride = policy.selectAiConfigForManualModel({
      baseConfig: savedSonnetBase,
      requestedModel: 'deepseek-v4.1-flash',
    });
    assert.equal(deepseekOverride.ok, true);
    assert.equal(deepseekOverride.config.model, 'deepseek-v4.1-flash');
    assert.equal(deepseekOverride.config.minOutputTokens, 16000);
  });

  await check('2. Validation rejects tampered, placeholder, non-string, and non-school-injected models', async () => {
    for (const bad of ['gpt-4o', '55sonnet', 'sonnet-tbd', 'https://evil.test/v1', 123, 'x'.repeat(200)]) {
      const res = policy.selectAiConfigForManualModel({
        baseConfig: schoolBaseConfig,
        requestedModel: bad,
      });
      assert.equal(res.ok, false, `Expected failure for ${String(bad)}`);
      assert.equal(res.status, 400);
    }

    const geminiConfig = {
      provider: 'gemini',
      apiKey: 'gem-key',
      model: 'gemini-3.5-flash',
      apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
      minOutputTokens: 0,
      jsonMode: 'none',
    };
    const preserved = policy.selectAiConfigForManualModel({ baseConfig: geminiConfig });
    assert.equal(preserved.ok, true);
    assert.equal(preserved.config.model, 'gemini-3.5-flash');

    const blockedInjection = policy.selectAiConfigForManualModel({
      baseConfig: geminiConfig,
      requestedModel: 'claude-sonnet-5-5',
    });
    assert.equal(blockedInjection.ok, false);
    assert.equal(blockedInjection.code, 'MODEL_SELECTION_NOT_SUPPORTED_FOR_PROVIDER');
  });

  await check('3. resolveAndVerifyManualModelConfig fails explicitly on unsupported/forbidden model without DeepSeek fallback', async () => {
    const unsupported = await policy.resolveAndVerifyManualModelConfig({
      baseConfig: schoolBaseConfig,
      requestedModel: 'claude-sonnet-5-5',
      verifyFn: async () => ({
        ok: true,
        hasModel: false,
        status: 200,
        modelIds: ['deepseek-v4.1-flash'],
        reason: 'not_found',
        message: 'missing',
      }),
    });
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.code, 'MODEL_NOT_AVAILABLE');

    const forbidden = await policy.resolveAndVerifyManualModelConfig({
      baseConfig: schoolBaseConfig,
      requestedModel: 'claude-sonnet-5-5',
      verifyFn: async () => ({
        ok: false,
        hasModel: false,
        status: 403,
        reason: 'forbidden',
        message: '권한 거부(403)',
      }),
    });
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.code, 'FORBIDDEN');
  });

  await check('4. Telemetry records actual response model and marks unverified Sonnet cost honestly', async () => {
    const origFetch = global.fetch;
    try {
      global.fetch = async () =>
        new Response(
          JSON.stringify({
            model: 'claude-sonnet-5-5',
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      const chatRes = await aiClient.callAiChat(
        { system: 'sys', user: 'usr', label: 'test-manual-model' },
        { ...schoolBaseConfig, model: 'claude-sonnet-5-5', minOutputTokens: 0, jsonMode: 'none' }
      );
      assert.equal(chatRes.ok, true);
      assert.equal(chatRes.model, 'claude-sonnet-5-5');
      const cost = telemetry.calculateAiCost(chatRes.model, 100, 50);
      assert.equal(cost.pricingModelFound, false);
      assert.equal(cost.estimatedCostUsd, 0);
    } finally {
      global.fetch = origFetch;
    }
  });

  // Shared mock harness for real Next.js Route Handlers
  function createRouteHarness() {
    const prevEnv = {
      AI_CREDENTIAL_ENCRYPTION_KEY: process.env.AI_CREDENTIAL_ENCRYPTION_KEY,
      ANALYSIS_RECOVERY_SIGNING_SECRET: process.env.ANALYSIS_RECOVERY_SIGNING_SECRET,
      AI_PROVIDER: process.env.AI_PROVIDER,
      BAZE_API_KEY: process.env.BAZE_API_KEY,
      BAZE_MODEL: process.env.BAZE_MODEL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    const origCreateClient = supabaseServerMod.createClient;
    const origCreateAdminClient = supabaseAdminMod.createAdminClient;
    const origHasAdminClientConfig = supabaseAdminMod.hasAdminClientConfig;
    const origRequireApiUser = apiAuthMod.requireApiUser;
    const origFetch = global.fetch;
    const origAiConfig = { ...aiConfigMod.AI_CONFIG };

    const encKey = Buffer.alloc(32, 7).toString('base64');
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = encKey;
    process.env.ANALYSIS_RECOVERY_SIGNING_SECRET = 'test-recovery-secret-manual-model';
    process.env.AI_PROVIDER = 'school_gateway';
    process.env.BAZE_API_KEY = 'operator-baze-key';
    process.env.BAZE_MODEL = 'deepseek-v4.1-flash';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    Object.assign(aiConfigMod.AI_CONFIG, {
      provider: 'school_gateway',
      apiKey: 'operator-baze-key',
      model: 'deepseek-v4.1-flash',
      apiBase: 'https://factchat-cloud.mindlogic.ai/v1/gateway',
      minOutputTokens: 16000,
      jsonMode: 'none',
    });

    const state = {
      user: { id: 'user-manual-1', email: 'student@inu.ac.kr' },
      userConnection: null,
      connectionLookupError: false,
      problemsById: {
        'prob-l1': {
          id: 'prob-l1',
          user_id: 'user-manual-1',
          is_demo: false,
          version: 1,
          payload: {
            title: 'Level 1 Problem',
            promptText: '기본 정의를 설명하시오.',
            modelAnswer: '기본 정의는 다음과 같다.',
            rubric: [{ id: 'r1', label: '정의', maxScore: 100, description: '정확한 정의' }],
            difficulty: 'basic',
            difficultyLevel: 1,
            conceptIds: ['c1'],
          },
        },
        'prob-l5': {
          id: 'prob-l5',
          user_id: 'user-manual-1',
          is_demo: false,
          version: 1,
          payload: {
            title: 'Level 5 Problem',
            promptText: '고난도 정리를 증명하시오.',
            modelAnswer: '모범 증명이다.',
            rubric: [{ id: 'r1', label: '증명', maxScore: 100, description: '엄밀성' }],
            difficulty: 'challenge',
            difficultyLevel: 5,
            conceptIds: ['c1'],
          },
        },
        'prob-foreign': {
          id: 'prob-foreign',
          user_id: 'other-user-999',
          is_demo: false,
          version: 1,
          payload: {
            title: 'Foreign Problem',
            promptText: '타인 문제',
            modelAnswer: '타인 모범답안',
            rubric: [{ id: 'r1', label: '기준', maxScore: 100 }],
            difficultyLevel: 4,
          },
        },
      },
      tasks: new Map(),
      trialBalance: 3,
      aiChatCalls: [],
      modelListCalls: [],
      registerCalls: 0,
      releaseCalls: [],
      settleCalls: [],
      forceRecordResultReadyError: false,
      forceProblemQueryError: null,
      forceProblemQueryThrow: false,
      gatewayModels: ['deepseek-v4.1-flash', 'claude-sonnet-5-5'],
      gatewayModelsStatus: 200,
    };

    function setUserKey(model = 'deepseek-v4.1-flash') {
      const secret = aiCreds.encryptSecret('user-baze-key', Buffer.from(encKey, 'base64'));
      state.userConnection = {
        provider: 'school_gateway',
        base_url: 'https://factchat-cloud.mindlogic.ai/v1/gateway',
        model,
        key_hint: 'user••••key',
        status: 'connected',
        last_checked_at: new Date().toISOString(),
        ciphertext: secret.ciphertext,
        iv: secret.iv,
        tag: secret.tag,
      };
    }

    function clearUserKey() {
      state.userConnection = null;
    }

    function makeSupabaseMock() {
      return {
        auth: {
          getUser: async () => ({ data: { user: state.user }, error: null }),
        },
        from(table) {
          if (table === 'ai_connections') {
            return {
              select() {
                return {
                  maybeSingle: async () => {
                    if (state.connectionLookupError) {
                      return { data: null, error: { message: 'DB connection lookup error' } };
                    }
                    if (!state.userConnection) return { data: null, error: null };
                    return {
                      data: {
                        provider: state.userConnection.provider,
                        model: state.userConnection.model,
                        key_hint: state.userConnection.key_hint,
                        status: state.userConnection.status,
                        last_checked_at: state.userConnection.last_checked_at,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          }
          if (table === 'problems') {
            return {
              select() {
                return {
                  eq(_col, val) {
                    return {
                      maybeSingle: async () => {
                        if (state.forceProblemQueryThrow) throw new Error('Simulated DB throw');
                        if (state.forceProblemQueryError) {
                          return { data: null, error: { message: state.forceProblemQueryError } };
                        }
                        return { data: state.problemsById[val] ?? null, error: null };
                      },
                    };
                  },
                };
              },
            };
          }
          if (table === 'problem_drafts') {
            return {
              upsert: async () => ({ data: [], error: null }),
              select: () => ({
                eq: () => ({ order: async () => ({ data: [], error: null }) }),
                in: async () => ({ data: [], error: null }),
              }),
            };
          }
          if (table === 'ai_usage_telemetry') {
            return { insert: async () => ({ error: null }) };
          }
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          };
        },
        async rpc(fn, params = {}) {
          if (fn === 'get_ai_connection_secret') {
            if (state.connectionLookupError) return { data: null, error: { message: 'RPC lookup failed' } };
            return { data: state.userConnection, error: null };
          }
          if (fn === 'touch_ai_connection') {
            if (!state.userConnection) return { data: null, error: { message: 'not found' } };
            if (params.p_model) state.userConnection.model = params.p_model;
            if (params.p_status) state.userConnection.status = params.p_status;
            return { data: null, error: null };
          }
          if (fn === 'save_ai_connection') {
            state.userConnection = {
              provider: params.p_provider,
              base_url: params.p_base_url,
              model: params.p_model,
              key_hint: params.p_key_hint,
              status: 'connected',
              last_checked_at: new Date().toISOString(),
              ciphertext: params.p_ciphertext,
              iv: params.p_iv,
              tag: params.p_tag,
            };
            return { data: { model: params.p_model }, error: null };
          }
          if (fn === 'get_trial_credit_status') {
            return {
              data: { granted: 3, used: 3 - state.trialBalance, balance: state.trialBalance, has_personal_key: Boolean(state.userConnection) },
              error: null,
            };
          }
          if (fn === 'consume_ai_call_budget') {
            return { data: { allowed: true }, error: null };
          }
          if (fn === 'register_ai_task') {
            state.registerCalls++;
            const existing = state.tasks.get(params.p_task_id);
            if (existing) {
              if (existing.userId !== params.p_user_id) {
                return { data: { allowed: false, error_code: 'TASK_OWNERSHIP_MISMATCH', message: 'ownership mismatch' }, error: null };
              }
              if (existing.inputIdentifier !== params.p_input_identifier) {
                return { data: { allowed: false, error_code: 'TASK_INPUT_MISMATCH', message: 'input mismatch' }, error: null };
              }
              if (existing.status === 'result_ready' || existing.status === 'settled') {
                return {
                  data: {
                    allowed: false,
                    status: 'already_completed',
                    cached_result: existing.cachedResult,
                    lease_token: existing.leaseToken,
                    task_id: params.p_task_id,
                    credit_source: existing.creditSource,
                    db_status: existing.status,
                  },
                  error: null,
                };
              }
              if (existing.status === 'reserved') {
                return { data: { allowed: false, status: 'concurrent_in_progress', task_id: params.p_task_id }, error: null };
              }
              // refunded -> allow new lease
              existing.status = 'reserved';
              existing.leaseToken = `lease-${params.p_task_id}-${Date.now()}`;
              if (!params.p_is_personal_key) state.trialBalance -= 1;
              return { data: { allowed: true, lease_token: existing.leaseToken, task_id: params.p_task_id, remaining: state.trialBalance }, error: null };
            }
            const creditSource = params.p_is_personal_key ? 'personal_key' : 'operator_trial';
            if (!params.p_is_personal_key) {
              if (state.trialBalance <= 0) {
                return { data: { allowed: false, error_code: 'INSUFFICIENT_CREDITS', message: 'no credits' }, error: null };
              }
              state.trialBalance -= 1;
            }
            const leaseToken = `lease-${params.p_task_id}`;
            state.tasks.set(params.p_task_id, {
              userId: params.p_user_id,
              taskType: params.p_task_type,
              inputIdentifier: params.p_input_identifier,
              creditSource,
              status: 'reserved',
              leaseToken,
              cachedResult: null,
            });
            return { data: { allowed: true, lease_token: leaseToken, task_id: params.p_task_id, remaining: state.trialBalance }, error: null };
          }
          if (fn === 'record_trial_result_ready') {
            if (state.forceRecordResultReadyError) {
              return { data: { success: false, error_code: 'DB_SAVE_FAIL', error: 'forced save failure' }, error: null };
            }
            const t = state.tasks.get(params.p_task_id);
            if (!t) return { data: { success: false, error_code: 'TASK_NOT_FOUND', error: 'not found' }, error: null };
            t.status = 'result_ready';
            t.cachedResult = params.p_result;
            return { data: { success: true }, error: null };
          }
          if (fn === 'settle_trial_credit') {
            state.settleCalls.push(params.p_task_id);
            const t = state.tasks.get(params.p_task_id);
            if (t) t.status = 'settled';
            return { data: { success: true }, error: null };
          }
          if (fn === 'release_trial_credit') {
            state.releaseCalls.push({ taskId: params.p_task_id, reason: params.p_reason });
            const t = state.tasks.get(params.p_task_id);
            if (t && t.status === 'reserved') {
              t.status = 'refunded';
              if (t.creditSource === 'operator_trial') state.trialBalance += 1;
            }
            return { data: { success: true }, error: null };
          }
          if (fn === 'lookup_saved_ai_task_result') {
            const t = state.tasks.get(params.p_task_id);
            if (!t || !t.cachedResult) {
              return { data: { success: false, error_code: 'SAVED_TASK_NOT_FOUND', message: 'not found' }, error: null };
            }
            return {
              data: {
                success: true,
                cached_result: t.cachedResult,
                lease_token: t.leaseToken,
                task_id: params.p_task_id,
                credit_source: t.creditSource,
                db_status: t.status,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
    }

    supabaseServerMod.createClient = async () => makeSupabaseMock();
    supabaseAdminMod.hasAdminClientConfig = () => true;
    supabaseAdminMod.createAdminClient = () => makeSupabaseMock();
    apiAuthMod.requireApiUser = async () => ({ ok: true, user: state.user });

    global.fetch = async (url, init = {}) => {
      const urlStr = String(url);
      const authHeader = init?.headers?.Authorization || init?.headers?.authorization || '';
      if (urlStr.includes('/models/')) {
        state.modelListCalls.push({ url: urlStr, authHeader });
        if (state.gatewayModelsStatus !== 200) {
          return new Response(JSON.stringify({ detail: 'gateway error' }), { status: state.gatewayModelsStatus });
        }
        return Response.json({ object: 'list', data: state.gatewayModels.map((id) => ({ id })) });
      }
      if (urlStr.includes('/chat/completions')) {
        const parsed = JSON.parse(String(init.body || '{}'));
        state.aiChatCalls.push({ url: urlStr, authHeader, body: parsed });

        let content = '{}';
        if (urlStr && parsed.messages?.[0]?.content?.includes('전이 문제')) {
          content = JSON.stringify({
            title: '전이 문항',
            promptText: '조건을 바꾼 전이 문항입니다.',
            type: 'essay_descriptive',
            difficulty: 'basic',
            conceptIds: ['c1'],
            transferKind: 'condition_shift',
            originalCondition: '원래 조건 A',
            newCondition: '새 조건 B',
            transferChanges: 'A를 B로 변경',
            understandingFocus: '조건 적용력',
            estimatedMinutes: 15,
            modelAnswer: '모범 답안',
            rubric: [{ id: 'r1', label: '핵심', maxScore: 100, description: '설명' }],
            hints: ['힌트'],
          });
        } else if (parsed.messages?.[0]?.content?.includes('논리 점검')) {
          content = JSON.stringify({
            questions: [
              { id: 'q1', question: '왜 이 정리를 적용했나요?', linkedCriterionId: 'r1', linkedQuote: '학생 답안' },
              { id: 'q2', question: '경계 조건은 확인했나요?', linkedCriterionId: 'r1', linkedQuote: '학생 답안' },
            ],
          });
        } else if (parsed.messages?.[0]?.content?.includes('품질 관리관')) {
          content = JSON.stringify({
            isReportJustified: false,
            severity: 'none',
            recommendation: 'dismiss_report',
            analysisSummary: '이상 없음',
            ruleChecks: [{ ruleName: '근거', passed: true, reason: '충분함' }],
          });
        } else if (parsed.messages?.[0]?.content?.includes('출제') && parsed.messages?.[0]?.content?.includes('problems')) {
          content = JSON.stringify({
            problems: [
              {
                title: '생성 문항 1',
                promptText: '다음 명제를 증명하시오.',
                modelAnswer: '모범 답안입니다.',
                rubric: [{ id: 'r1', label: '논리', maxScore: 100, description: '논리 전개' }],
                hints: ['힌트 1'],
                estimatedMinutes: 20,
              },
            ],
          });
        } else {
          content = JSON.stringify({
            rubricResults: [{ criterionId: 'r1', score: 80, feedback: '좋음', evidenceQuote: '학생 답안' }],
            overallFeedback: '전반적으로 잘 풀었습니다.',
            strengths: ['논리적임'],
            weaknesses: [],
            recommendedErrorType: 'none',
          });
        }

        return Response.json({
          model: parsed.model,
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const makeReq = (body) =>
      new Request('http://localhost/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    return {
      state,
      setUserKey,
      clearUserKey,
      makeReq,
      cleanup() {
        supabaseServerMod.createClient = origCreateClient;
        supabaseAdminMod.createAdminClient = origCreateAdminClient;
        supabaseAdminMod.hasAdminClientConfig = origHasAdminClientConfig;
        apiAuthMod.requireApiUser = origRequireApiUser;
        global.fetch = origFetch;
        Object.assign(aiConfigMod.AI_CONFIG, origAiConfig);
        for (const [k, v] of Object.entries(prevEnv)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      },
    };
  }

  await check('5. Route handlers: Level 1 chooses Sonnet, Level 5 chooses DeepSeek, saved default & DeepSeek fallback work', async () => {
    const h = createRouteHarness();
    try {
      h.setUserKey('deepseek-v4.1-flash');

      // Level 1 -> explicit Sonnet
      const genL1Sonnet = await genRoute.POST(
        h.makeReq({
          subjectId: 'sub-1',
          subjectDomain: 'math_stats',
          concepts: [{ id: 'c1', subjectId: 'sub-1', title: '베이즈 정리', description: '조건부 확률' }],
          problemType: 'essay_descriptive',
          difficulty: 'basic',
          difficultyLevel: 1,
          problemCount: 1,
          selectedModel: 'claude-sonnet-5-5',
          sources: [{ materialId: 'm1', title: '강의1', markdown: '베이즈 정리 본문' }],
        })
      );
      const genL1SonnetBody = await genL1Sonnet.json();
      assert.equal(genL1Sonnet.status, 200, JSON.stringify(genL1SonnetBody));
      assert.equal(h.state.aiChatCalls[0].body.model, 'claude-sonnet-5-5');
      assert.equal(h.state.aiChatCalls[0].body.max_tokens, undefined, 'Sonnet must not copy DeepSeek 16000 minOutputTokens');

      // Level 5 -> explicit DeepSeek
      const evalL5Deepseek = await evalRoute.POST(
        h.makeReq({
          problemId: 'prob-l5',
          problemVersion: 1,
          conceptId: 'c1',
          subjectId: 'sub-1',
          domain: 'math_stats',
          problemTitle: 'Level 5 Problem',
          problemPrompt: '고난도 정리를 증명하시오.',
          modelAnswer: '모범 증명이다.',
          rubric: [{ id: 'r1', label: '증명', maxScore: 100 }],
          userAnswer: '학생 답안입니다.',
          selectedModel: 'deepseek-v4.1-flash',
        })
      );
      assert.equal(evalL5Deepseek.status, 200);
      assert.equal(h.state.aiChatCalls[1].body.model, 'deepseek-v4.1-flash');

      // Level 5 with NO selectedModel -> uses user saved default (claude-sonnet-5-5), NOT difficulty-forced
      h.setUserKey('claude-sonnet-5-5');
      const evalSavedSonnet = await evalRoute.POST(
        h.makeReq({
          problemId: 'prob-l1',
          problemVersion: 1,
          conceptId: 'c1',
          subjectId: 'sub-1',
          domain: 'math_stats',
          problemTitle: 'Level 1 Problem',
          problemPrompt: '기본 정의를 설명하시오.',
          modelAnswer: '기본 정의는 다음과 같다.',
          rubric: [{ id: 'r1', label: '정의', maxScore: 100 }],
          userAnswer: '학생 답안입니다.',
        })
      );
      assert.equal(evalSavedSonnet.status, 200);
      assert.equal(h.state.aiChatCalls[2].body.model, 'claude-sonnet-5-5');

      // Unregistered user (trial) with NO selectedModel -> uses operator default (deepseek-v4.1-flash) even on Level 5
      h.clearUserKey();
      const evalTrialDefault = await evalRoute.POST(
        h.makeReq({
          problemId: 'prob-l5',
          problemVersion: 1,
          conceptId: 'c1',
          subjectId: 'sub-1',
          domain: 'math_stats',
          problemTitle: 'Level 5 Problem',
          problemPrompt: '고난도 정리를 증명하시오.',
          modelAnswer: '모범 증명이다.',
          rubric: [{ id: 'r1', label: '증명', maxScore: 100 }],
          userAnswer: '체험 사용자 답안입니다.',
        })
      );
      assert.equal(evalTrialDefault.status, 200);
      assert.equal(h.state.aiChatCalls[3].body.model, 'deepseek-v4.1-flash');
      assert.equal(h.state.aiChatCalls[3].authHeader, 'Bearer operator-baze-key');
    } finally {
      h.cleanup();
    }
  });

  await check('6. Tampered/unsupported model & gateway lookup failure block with 0 AI calls & release trial credit', async () => {
    const h = createRouteHarness();
    try {
      h.clearUserKey();
      const startBalance = h.state.trialBalance;

      // Tampered model -> 400 before credit reservation
      const tampered = await evalRoute.POST(
        h.makeReq({
          problemId: 'prob-l1',
          problemVersion: 1,
          conceptId: 'c1',
          subjectId: 'sub-1',
          domain: 'math_stats',
          problemTitle: 'Level 1 Problem',
          problemPrompt: '기본 정의를 설명하시오.',
          modelAnswer: '기본 정의는 다음과 같다.',
          rubric: [{ id: 'r1', label: '정의', maxScore: 100 }],
          userAnswer: '학생 답안',
          selectedModel: 'gpt-4o-hacked',
        })
      );
      assert.equal(tampered.status, 400);
      assert.equal(h.state.registerCalls, 0);
      assert.equal(h.state.aiChatCalls.length, 0);
      assert.equal(h.state.trialBalance, startBalance);

      // Unsupported model on gateway (only deepseek enabled) -> 400 + credit refunded + 0 AI calls
      h.state.gatewayModels = ['deepseek-v4.1-flash'];
      const unsupported = await evalRoute.POST(
        h.makeReq({
          problemId: 'prob-l1',
          problemVersion: 1,
          conceptId: 'c1',
          subjectId: 'sub-1',
          domain: 'math_stats',
          problemTitle: 'Level 1 Problem',
          problemPrompt: '기본 정의를 설명하시오.',
          modelAnswer: '기본 정의는 다음과 같다.',
          rubric: [{ id: 'r1', label: '정의', maxScore: 100 }],
          userAnswer: '학생 답안',
          selectedModel: 'claude-sonnet-5-5',
        })
      );
      assert.equal(unsupported.status, 400);
      assert.equal(h.state.aiChatCalls.length, 0);
      assert.equal(h.state.trialBalance, startBalance, 'Trial credit must be refunded when model is unsupported');

      // Gateway 403 -> 400 + credit refunded + 0 AI calls
      h.state.gatewayModelsStatus = 403;
      const forbidden = await evalRoute.POST(
        h.makeReq({
          problemId: 'prob-l1',
          problemVersion: 1,
          conceptId: 'c1',
          subjectId: 'sub-1',
          domain: 'math_stats',
          problemTitle: 'Level 1 Problem',
          problemPrompt: '기본 정의를 설명하시오.',
          modelAnswer: '기본 정의는 다음과 같다.',
          rubric: [{ id: 'r1', label: '정의', maxScore: 100 }],
          userAnswer: '학생 답안',
          selectedModel: 'claude-sonnet-5-5',
        })
      );
      assert.equal(forbidden.status, 400);
      assert.equal(h.state.aiChatCalls.length, 0);
      assert.equal(h.state.trialBalance, startBalance);
    } finally {
      h.cleanup();
    }
  });

  await check('7. DB ownership / error / throw / missing problemId still fail closed with 0 AI calls', async () => {
    const h = createRouteHarness();
    try {
      h.setUserKey('deepseek-v4.1-flash');

      // Foreign problemId
      const foreignRes = await transferRoute.POST(
        h.makeReq({
          problemId: 'prob-foreign',
          domain: 'math_stats',
          problemTitle: 'Foreign',
          problemPrompt: 'p',
          problemType: 'essay_descriptive',
          difficulty: 'basic',
          concepts: [{ id: 'c1', title: 'C1' }],
          modelAnswer: 'ma',
          originalAnswer: 'oa',
          rubric: [{ id: 'r1', label: 'L', maxScore: 100, description: 'D' }],
        })
      );
      assert.equal(foreignRes.status, 404);
      assert.equal(h.state.registerCalls, 0);
      assert.equal(h.state.aiChatCalls.length, 0);

      // DB throw
      h.state.forceProblemQueryThrow = true;
      const throwRes = await reviewRoute.POST(
        h.makeReq({
          problem: {
            id: 'prob-l1',
            title: 'T',
            type: 'essay_descriptive',
            promptText: 'P',
            modelAnswer: 'M',
            rubric: [{ id: 'r1', label: 'L', maxScore: 100 }],
          },
          reports: [{ id: 'rep1', type: 'error', details: 'check', status: 'open' }],
        })
      );
      assert.equal(throwRes.status, 500);
      assert.equal(h.state.registerCalls, 0);
      assert.equal(h.state.aiChatCalls.length, 0);
      h.state.forceProblemQueryThrow = false;

      // Missing problemId with isProvisionalLocal: false
      const missingRes = await logicRoute.POST(
        h.makeReq({
          problemId: 'nonexistent-id',
          isProvisionalLocal: false,
          domain: 'math_stats',
          problemTitle: 'T',
          problemPrompt: 'P',
          modelAnswer: 'M',
          originalAnswer: '학생 답안',
          rubric: [{ id: 'r1', label: 'L', maxScore: 100 }],
        })
      );
      assert.equal(missingRes.status, 404);
      assert.equal(h.state.registerCalls, 0);
      assert.equal(h.state.aiChatCalls.length, 0);
    } finally {
      h.cleanup();
    }
  });

  await check('8. Same input with different models gets isolated taskId & cache; save-retry & legacy token recovery work after model change', async () => {
    const h = createRouteHarness();
    try {
      h.setUserKey('deepseek-v4.1-flash');

      const baseEvalPayload = {
        problemId: 'prob-l1',
        problemVersion: 1,
        conceptId: 'c1',
        subjectId: 'sub-1',
        domain: 'math_stats',
        problemTitle: 'Level 1 Problem',
        problemPrompt: '기본 정의를 설명하시오.',
        modelAnswer: '기본 정의는 다음과 같다.',
        rubric: [{ id: 'r1', label: '정의', maxScore: 100 }],
        userAnswer: '동일한 학생 답안입니다.',
      };

      // 1) Run with DeepSeek
      const resDeepseek = await evalRoute.POST(
        h.makeReq({ ...baseEvalPayload, selectedModel: 'deepseek-v4.1-flash' })
      );
      const dataDeepseek = await resDeepseek.json();
      assert.equal(resDeepseek.status, 200, JSON.stringify(dataDeepseek));
      assert.equal(h.state.aiChatCalls.length, 1);

      // 2) Run same input with Sonnet -> must NOT hit DeepSeek cache; must have distinct taskId
      const resSonnet = await evalRoute.POST(
        h.makeReq({ ...baseEvalPayload, selectedModel: 'claude-sonnet-5-5' })
      );
      const dataSonnet = await resSonnet.json();
      assert.equal(resSonnet.status, 200);
      assert.equal(h.state.aiChatCalls.length, 2);
      assert.notEqual(dataDeepseek.taskId, dataSonnet.taskId, 'Different models must have isolated taskIds');
      assert.equal(h.state.aiChatCalls[1].body.model, 'claude-sonnet-5-5');

      // 3) Save failure -> recovery token -> change default model in Settings -> retry save with 0 AI calls
      h.state.forceRecordResultReadyError = true;
      const failEval = await evalRoute.POST(
        h.makeReq({
          ...baseEvalPayload,
          userAnswer: '저장 실패 후 복구할 답안입니다.',
          selectedModel: 'claude-sonnet-5-5',
        })
      );
      const failData = await failEval.json();
      assert.equal(failEval.status, 500);
      assert.equal(failData.canRetrySave, true);
      assert.ok(failData.signedRecoveryToken);
      assert.equal(h.state.aiChatCalls.length, 3);

      // Change user default model in Settings to deepseek-v4.1-flash before retrying save
      h.setUserKey('deepseek-v4.1-flash');
      h.state.forceRecordResultReadyError = false;

      // Tampered token rejected when server DB doesn't have saved result
      const tamperedRetry = await evalRoute.POST(
        h.makeReq({
          ...baseEvalPayload,
          userAnswer: '저장 실패 후 복구할 답안입니다.',
          isSaveRetry: true,
          action: 'retry_save',
          taskId: failData.taskId,
          signedRecoveryToken: `${failData.signedRecoveryToken}tampered`,
          recoveryData: failData.recoveryData,
        })
      );
      assert.equal(tamperedRetry.status, 400);

      const retryRes = await evalRoute.POST(
        h.makeReq({
          ...baseEvalPayload,
          userAnswer: '저장 실패 후 복구할 답안입니다.',
          isSaveRetry: true,
          action: 'retry_save',
          taskId: failData.taskId,
          signedRecoveryToken: failData.signedRecoveryToken,
          recoveryData: failData.recoveryData,
        })
      );
      const retryData = await retryRes.json();
      assert.equal(retryRes.status, 200);
      assert.equal(retryData.success, true);
      assert.equal(h.state.aiChatCalls.length, 3, 'Save retry must NOT re-call AI');

      // Legacy no-model recovery token compatibility
      const legacyNoModelBase = {
        version: 'v3',
        domain: 'math_stats',
        problemId: 'prob-l1',
        problemVersion: 1,
        isProvisional: false,
        mockExamSessionId: '',
        verifiedPrompt: '기본 정의를 설명하시오.',
        verifiedModelAnswer: '기본 정의는 다음과 같다.',
        verifiedRubric: [{ id: 'r1', label: '정의', maxScore: 100, description: '정확한 정의' }],
        mathFormula: '',
        codeSnippet: '',
        appliedConditionNote: '',
        problemType: '',
        conceptIds: ['c1'],
        userAnswer: '레거시 토큰 답안',
        solvingReason: '',
        isReasonNotApplicable: false,
        reasonNotApplicableJustification: '',
        revealedHintCount: 0,
        hints: [],
        isMockExam: false,
      };
      const legacyInputId = markdownUtilsMod.computeAiTaskInputIdentifier(legacyNoModelBase, 'v1');
      const legacyTaskId = `eval_${h.state.user.id}_${legacyInputId}`;
      const legacyRecoveryData = {
        evaluation: { rubricScores: [{ criterionId: 'r1', awardedScore: 90, feedback: 'ok' }], calculatedScore: 90, maxTotalScore: 100 },
        problemId: 'prob-l1',
        conceptId: 'c1',
        conceptIds: ['c1'],
        subjectId: 'sub-1',
        isProvisionalLocal: false,
      };
      const legacyToken = recoveryTokenMod.signTaskRecoveryToken({
        userId: h.state.user.id,
        taskId: legacyTaskId,
        taskType: 'evaluate_answer',
        inputIdentifier: legacyInputId,
        result: legacyRecoveryData,
        modelId: 'deepseek-v4.1-flash',
      });
      const legacyRetry = await evalRoute.POST(
        h.makeReq({
          ...baseEvalPayload,
          userAnswer: '레거시 토큰 답안',
          isSaveRetry: true,
          action: 'retry_save',
          taskId: legacyTaskId,
          signedRecoveryToken: legacyToken,
          recoveryData: legacyRecoveryData,
        })
      );
      const legacyRetryBody = await legacyRetry.json();
      assert.equal(legacyRetry.status, 200, JSON.stringify(legacyRetryBody));
      assert.equal(h.state.aiChatCalls.length, 3, 'Legacy token recovery must succeed with 0 AI calls');
    } finally {
      h.cleanup();
    }
  });

  await check('9. ai-connection GET/POST(useStoredKey)/PUT(model-only) work without re-entering API key', async () => {
    const h = createRouteHarness();
    try {
      h.setUserKey('deepseek-v4.1-flash');

      const getRes = await aiConnectionRoute.GET();
      const getData = await getRes.json();
      assert.equal(getRes.status, 200);
      assert.equal(getData.connected, true);
      assert.equal(getData.model, 'deepseek-v4.1-flash');
      assert.equal(getData.difficultyBoundaryLevel, undefined);
      assert.ok(Array.isArray(getData.availableSchoolModels));

      const postRes = await aiConnectionRoute.POST(h.makeReq({ useStoredKey: true }));
      const postData = await postRes.json();
      assert.equal(postRes.status, 200);
      assert.equal(postData.verified, true);
      assert.deepEqual(postData.models, ['deepseek-v4.1-flash', 'claude-sonnet-5-5']);

      const putRes = await aiConnectionRoute.PUT(h.makeReq({ model: 'claude-sonnet-5-5' }));
      const putData = await putRes.json();
      assert.equal(putRes.status, 200);
      assert.equal(putData.model, 'claude-sonnet-5-5');
      assert.equal(h.state.userConnection.model, 'claude-sonnet-5-5');

      // Lookup failure must return 502, never unregistered
      h.state.connectionLookupError = true;
      const failGet = await aiConnectionRoute.GET();
      assert.equal(failGet.status, 502);
    } finally {
      h.cleanup();
    }
  });

  await check('10. Client lookup helper preserves user selection during slow GET & keeps saved non-DeepSeek school model', async () => {
    const selectionClient = load(path.join(output, 'lib', 'aiModelSelectionClient.js'));
    // Late GET completion after user already selected claude-sonnet-5-5 -> must preserve user choice
    const lateOverwriteGuard = selectionClient.applyAiConnectionLookup(
      { success: true, connected: true, model: 'deepseek-v4.1-flash' },
      'claude-sonnet-5-5',
      true
    );
    assert.equal(lateOverwriteGuard.nextSelectedModel, 'claude-sonnet-5-5');
    assert.equal(lateOverwriteGuard.savedDefaultModel, 'deepseek-v4.1-flash');

    // Clean initial load when user has not modified -> applies saved default
    const cleanLoad = selectionClient.applyAiConnectionLookup(
      { success: true, connected: true, model: 'claude-sonnet-5-5' },
      'deepseek-v4.1-flash',
      false
    );
    assert.equal(cleanLoad.nextSelectedModel, 'claude-sonnet-5-5');

    // Saved valid school model outside [deepseek, sonnet] -> NOT rewritten to deepseek, added to options
    const customSchool = selectionClient.applyAiConnectionLookup(
      { success: true, connected: true, model: 'qwen3-coder' },
      'deepseek-v4.1-flash',
      false
    );
    assert.equal(customSchool.savedDefaultModel, 'qwen3-coder');
    assert.equal(customSchool.nextSelectedModel, 'qwen3-coder');
    assert.ok(customSchool.availableModels.some((o) => o.id === 'qwen3-coder'));
  });

  await check('11. Server pins pre-confirmed model on mid-flight default change & rejects key/provider change with 409', async () => {
    const h = createRouteHarness();
    try {
      h.setUserKey('deepseek-v4.1-flash');
      const { aiCredentials: credsMod } = { aiCredentials: load(path.join(output, 'lib', 'aiCredentials.js')) };
      assert.ok(credsMod);

      // Case A: Mid-flight default model change (same user, same provider, same key)
      // resolveEffectiveModelForRequest sees deepseek-v4.1-flash; then cred.config has claude-sonnet-5-5
      const pinnedRes = await policy.resolveEffectiveModelForRequest({
        userId: 'user-1',
        requestedModel: undefined,
        lookupFn: async () => ({
          status: 'registered',
          secret: { provider: 'school_gateway', model: 'deepseek-v4.1-flash', apiKey: 'sk-same' },
        }),
      });
      assert.equal(pinnedRes.ok, true);
      assert.equal(pinnedRes.effectiveModel, 'deepseek-v4.1-flash');

      const routedPinned = await policy.resolveAndVerifyManualModelConfig({
        baseConfig: {
          provider: 'school_gateway',
          apiKey: 'sk-same',
          apiBase: 'https://baze.example/v1',
          model: 'claude-sonnet-5-5',
          minOutputTokens: 0,
          jsonMode: 'none',
        },
        requestedModel: undefined,
        pinnedResolution: pinnedRes,
        credSource: 'user',
        verifyFn: async (_k, _b, m) => ({ ok: true, hasModel: m === 'deepseek-v4.1-flash', modelIds: ['deepseek-v4.1-flash', 'claude-sonnet-5-5'] }),
      });
      assert.equal(routedPinned.ok, true);
      assert.equal(routedPinned.config.model, 'deepseek-v4.1-flash', 'Actual call model must match hashed effectiveModel');

      // Case B: Mid-flight API key change -> 409 AI_CONNECTION_CHANGED_CONFLICT (never mix keys)
      const routedKeyConflict = await policy.resolveAndVerifyManualModelConfig({
        baseConfig: {
          provider: 'school_gateway',
          apiKey: 'sk-changed',
          apiBase: 'https://baze.example/v1',
          model: 'deepseek-v4.1-flash',
          minOutputTokens: 16000,
          jsonMode: 'json_object',
        },
        requestedModel: undefined,
        pinnedResolution: pinnedRes,
        credSource: 'user',
        verifyFn: async () => ({ ok: true, hasModel: true, modelIds: ['deepseek-v4.1-flash'] }),
      });
      assert.equal(routedKeyConflict.ok, false);
      assert.equal(routedKeyConflict.status, 409);
      assert.equal(routedKeyConflict.code, 'AI_CONNECTION_CHANGED_CONFLICT');

      // Case C: Mid-flight provider change -> 409 AI_CONNECTION_CHANGED_CONFLICT
      const routedProviderConflict = await policy.resolveAndVerifyManualModelConfig({
        baseConfig: {
          provider: 'openai',
          apiKey: 'sk-same',
          apiBase: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          minOutputTokens: 0,
          jsonMode: 'none',
        },
        requestedModel: undefined,
        pinnedResolution: pinnedRes,
        credSource: 'user',
      });
      assert.equal(routedProviderConflict.ok, false);
      assert.equal(routedProviderConflict.status, 409);
      assert.equal(routedProviderConflict.code, 'AI_CONNECTION_CHANGED_CONFLICT');
    } finally {
      h.cleanup();
    }
  });

  await check('12. Saved arbitrary valid school model (e.g. qwen3-coder) works when omitted or explicitly re-sent while tampering is rejected', async () => {
    const h = createRouteHarness();
    try {
      h.setUserKey('qwen3-coder');
      h.state.gatewayModels = ['deepseek-v4.1-flash', 'claude-sonnet-5-5', 'qwen3-coder'];

      // Explicit re-send of saved valid school model -> 200
      const resExplicit = await genRoute.POST(
        h.makeReq({
          subjectId: 'sub-1',
          subjectDomain: 'math_stats',
          problemType: 'essay_descriptive',
          difficulty: 'basic',
          difficultyLevel: 2,
          problemCount: 1,
          concepts: [{ id: 'c1', subjectId: 'sub-1', title: 'Tree', description: 'BST' }],
          sources: [{ materialId: 'm1', title: 'Notes', markdown: 'BST invariant' }],
          selectedModel: 'qwen3-coder',
        })
      );
      const resExplicitBody = await resExplicit.json();
      assert.equal(resExplicit.status, 200, JSON.stringify(resExplicitBody));
      assert.equal(h.state.aiChatCalls.at(-1).body.model, 'qwen3-coder');
      assert.equal(h.state.aiChatCalls.at(-1).body.max_tokens, undefined);

      // Tampered non-allowed, non-saved model -> 400
      const resTampered = await genRoute.POST(
        h.makeReq({
          subjectId: 'sub-1',
          subjectDomain: 'math_stats',
          problemType: 'essay_descriptive',
          difficulty: 'basic',
          difficultyLevel: 2,
          problemCount: 1,
          concepts: [{ id: 'c1', subjectId: 'sub-1', title: 'Tree', description: 'BST' }],
          sources: [{ materialId: 'm1', title: 'Notes', markdown: 'BST invariant' }],
          selectedModel: 'evil-model-xyz',
        })
      );
      assert.equal(resTampered.status, 400);
      assert.equal(h.state.aiChatCalls.length, 1);
    } finally {
      h.cleanup();
    }
  });
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

console.log(`\nSummary: ${passed} passed / ${failed} failed`);
if (failed > 0) process.exit(1);
