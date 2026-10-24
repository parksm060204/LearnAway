import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve('supabase/migrations');

// Helper to set mock auth context in PGlite session
async function setAuthContext(db, { uid = null, role = 'service_role' } = {}) {
  const u = uid ? `'${uid}'` : "''";
  const r = `'${role}'`;
  await db.exec(`
    select set_config('request.jwt.claim.sub', ${u}, false);
    select set_config('request.jwt.claim.role', ${r}, false);
  `);
}

// Setup common Supabase mock environment
async function setupSupabaseMocks(db) {
  await db.exec(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end $$;

    create schema if not exists auth;
    create schema if not exists storage;

    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    create or replace function auth.role()
    returns text
    language sql
    stable
    as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$;

    create table if not exists storage.buckets (
      id text primary key,
      name text not null,
      public boolean default false,
      created_at timestamptz default now()
    );

    create or replace function storage.foldername(name text)
    returns text[]
    language sql
    immutable
    as $$
      select string_to_array(name, '/');
    $$;

    create or replace function storage.filename(name text)
    returns text
    language sql
    immutable
    as $$
      select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)];
    $$;

    create or replace function storage.extension(name text)
    returns text
    language sql
    immutable
    as $$
      select split_part(name, '.', 2);
    $$;

    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id),
      name text not null,
      owner uuid,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
}

async function runSqlFile(db, filePath) {
  let sql = fs.readFileSync(filePath, 'utf8');
  // PGlite stubbing: pgcrypto extension is built-in as native PostgreSQL 13+ gen_random_uuid() in WASM
  sql = sql.replace(/create extension if not exists ["']pgcrypto["'];?/gi, '-- [pglite stub] pgcrypto');
  try {
    await db.exec(sql);
  } catch (err) {
    console.error(`FAILED on migration: ${path.basename(filePath)} - Error: ${err.message} (${err.code})`);
    throw err;
  }
}

async function testUpgradePath() {
  console.log('=== [1] Testing Upgrade Path: DB with Migrations 00~31 -> Apply Migration 32 ===');
  const db = new PGlite();
  await setupSupabaseMocks(db);

  // 1. Run migrations 00 to 31 (Strictly exclude 32 so previous version DB is tested!)
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  const pre32Files = files.filter(f => f < '20260101000032_');

  for (const f of pre32Files) {
    // console.log(`Applying ${f}...`);
    await runSqlFile(db, path.join(MIGRATIONS_DIR, f));
  }
  console.log(`✓ Successfully applied ${pre32Files.length} migrations up to 31`);

  // 2. Insert mock pre-migration data
  const userIdA = '11111111-1111-1111-1111-111111111111';
  const userIdB = '22222222-2222-2222-2222-222222222222';

  await db.query(`
    insert into auth.users (id, email, raw_user_meta_data)
    values ($1, 'userA@example.com', '{"auth_type":"email"}'::jsonb),
           ($2, 'guestB@id.learnaway.local', '{"auth_type":"username"}'::jsonb);
  `, [userIdA, userIdB]);

  // Give user A 3 credits, guest B 1 credit
  await db.query(`
    insert into public.ai_trial_credits (user_id, granted_credits, balance, granted_at, updated_at)
    values ($1, 3, 3, now(), now()),
           ($2, 1, 1, now(), now());
  `, [userIdA, userIdB]);

  // Insert existing pre-migration reservation in 'result_ready' status
  await db.query(`
    insert into public.ai_trial_reservations (
      task_id, user_id, task_type, input_identifier, status, attempt_count,
      lease_token, lease_expires_at, cached_result, created_at
    ) values (
      'task_pre_result_ready', $1, 'analyze_concepts', 'input_pre', 'result_ready', 1,
      'lt_pre_token', now() - interval '1 hour', '{"concepts": ["calculus"]}'::jsonb, now() - interval '2 hours'
    );
  `, [userIdA]);

  console.log('✓ Successfully populated pre-migration existing data (credits & result_ready reservation)');

  // 3. Apply Migration 32
  const migration32File = files.find(f => f.includes('000032_'));
  console.log(`Applying Migration 32: ${migration32File}...`);
  await runSqlFile(db, path.join(MIGRATIONS_DIR, migration32File));
  console.log('✓ Migration 32 executed cleanly!');

  // Now execute Scenarios A through L
  await setAuthContext(db, { uid: userIdA, role: 'service_role' });

  // --------------------------------------------------------------------------
  // Scenario A: Reservation -> Result Ready -> Settle
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario A: Reservation -> Result Ready -> Settle ---');
  const taskIdA = 'task_a_' + Date.now();
  const resA1 = await db.query(`
    select public.reserve_trial_credit($1, 'analyze_concepts', 'input_a', $2, 500) as r;
  `, [taskIdA, userIdA]);
  const reserveDataA = resA1.rows[0].r;
  if (!reserveDataA.allowed || reserveDataA.status !== 'reserved' || reserveDataA.remaining !== 2) {
    throw new Error(`Scenario A reserve failed: ${JSON.stringify(reserveDataA)}`);
  }
  const leaseTokenA = reserveDataA.lease_token;
  console.log(`✓ Reserved credit: remaining=2, leaseToken=${leaseTokenA}`);

  // Check operator_ai_daily_usage count is 1
  const daily1 = await db.query(`select call_count from public.operator_ai_daily_usage where usage_date = current_date;`);
  if (daily1.rows[0].call_count !== 1) {
    throw new Error(`Expected operator daily usage count=1, got ${daily1.rows[0].call_count}`);
  }
  console.log('✓ Operator daily usage incremented once on reservation (call_count=1)');

  // Record result ready
  const resA2 = await db.query(`
    select public.record_trial_result_ready($1, '{"concepts":["derivative"]}'::jsonb, $2, $3) as r;
  `, [taskIdA, userIdA, leaseTokenA]);
  const readyDataA = resA2.rows[0].r;
  if (!readyDataA.success || readyDataA.status !== 'result_ready') {
    throw new Error(`Scenario A record_trial_result_ready failed: ${JSON.stringify(readyDataA)}`);
  }
  console.log('✓ Recorded result ready: status=result_ready');

  // Verify DB state of reservation
  const rowA = (await db.query(`select status, cached_result from public.ai_trial_reservations where task_id = $1;`, [taskIdA])).rows[0];
  if (rowA.status !== 'result_ready' || !rowA.cached_result) {
    throw new Error(`Reservation row did not transition to result_ready: ${JSON.stringify(rowA)}`);
  }
  console.log('✓ DB state verified: status=result_ready, cached_result preserved');

  // Settle credit
  const resA3 = await db.query(`
    select public.settle_trial_credit($1, $2, $3) as r;
  `, [taskIdA, userIdA, leaseTokenA]);
  const settleDataA = resA3.rows[0].r;
  if (!settleDataA.success || settleDataA.status !== 'settled') {
    throw new Error(`Scenario A settle failed: ${JSON.stringify(settleDataA)}`);
  }
  console.log('✓ Settled credit: status=settled');

  // Verify daily usage was NOT double-counted on settle
  const daily2 = await db.query(`select call_count from public.operator_ai_daily_usage where usage_date = current_date;`);
  if (daily2.rows[0].call_count !== 1) {
    throw new Error(`Expected operator daily usage count to remain 1 after settle, got ${daily2.rows[0].call_count}`);
  }
  console.log('✓ No duplicate operator daily usage increment on settle (remains 1)');

  // --------------------------------------------------------------------------
  // Scenario B: Result Ready -> Storage failure -> Lease expired -> Retry
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario B: Result Ready -> Downstream failure -> Lease expired -> Retry ---');
  const taskIdB = 'task_b_' + Date.now();
  const resB1 = await db.query(`
    select public.reserve_trial_credit($1, 'generate_problems', 'input_b', $2, 500) as r;
  `, [taskIdB, userIdA]);
  const tokenB = resB1.rows[0].r.lease_token;
  console.log(`✓ Reserved task B with leaseToken=${tokenB}`);

  // Record result
  await db.query(`
    select public.record_trial_result_ready($1, '{"problems":[{"q":"1+1"}]}'::jsonb, $2, $3) as r;
  `, [taskIdB, userIdA, tokenB]);

  // Simulate lease expiration
  await db.query(`
    update public.ai_trial_reservations
    set lease_expires_at = now() - interval '10 seconds'
    where task_id = $1;
  `, [taskIdB]);
  console.log('✓ Simulated lease expiration for task B');

  // Retry reserve_trial_credit: MUST return already_completed and preserved result, NO AI execution!
  const resB2 = await db.query(`
    select public.reserve_trial_credit($1, 'generate_problems', 'input_b', $2, 500) as r;
  `, [taskIdB, userIdA]);
  const retryDataB = resB2.rows[0].r;
  if (retryDataB.allowed !== false || retryDataB.status !== 'already_completed' || !retryDataB.cached_result) {
    throw new Error(`Scenario B retry failed to protect AI: ${JSON.stringify(retryDataB)}`);
  }
  console.log('✓ Retry returned status=already_completed with cached_result. ZERO additional AI executions permitted!');

  // Attempting to refund a result_ready task MUST be rejected!
  const refundB = await db.query(`
    select public.release_trial_credit($1, 'storage_failed', $2, $3) as r;
  `, [taskIdB, userIdA, tokenB]);
  if (refundB.rows[0].r.success !== false || refundB.rows[0].r.error_code !== 'CANNOT_REFUND_RESULT_READY') {
    throw new Error(`Expected release to be rejected on result_ready, got: ${JSON.stringify(refundB.rows[0].r)}`);
  }
  console.log('✓ release_trial_credit properly rejected refund for result_ready task (cannot refund consumed AI)');

  // --------------------------------------------------------------------------
  // Scenario C: Pre-migration result_ready row preserved & safely recovered
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario C: Pre-migration result_ready row recovery ---');
  const resC1 = await db.query(`
    select public.reserve_trial_credit('task_pre_result_ready', 'analyze_concepts', 'input_pre', $1, 500) as r;
  `, [userIdA]);
  const dataC1 = resC1.rows[0].r;
  if (dataC1.allowed !== false || dataC1.status !== 'already_completed' || !dataC1.cached_result?.concepts) {
    throw new Error(`Pre-migration row check failed: ${JSON.stringify(dataC1)}`);
  }
  console.log('✓ Pre-existing result_ready row correctly recognized as already_completed with cached_result');

  // Settle pre-migration row
  const resC2 = await db.query(`
    select public.settle_trial_credit('task_pre_result_ready', $1, 'lt_pre_token') as r;
  `, [userIdA]);
  if (!resC2.rows[0].r.success || resC2.rows[0].r.status !== 'settled') {
    throw new Error(`Pre-migration settle failed: ${JSON.stringify(resC2.rows[0].r)}`);
  }
  console.log('✓ Pre-existing result_ready row successfully settled');

  // --------------------------------------------------------------------------
  // Scenario D: Pre-generation failure -> Refund -> Retry
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario D: AI failure prior to result -> Refund -> Retry ---');
  const taskIdD = 'task_d_' + Date.now();
  const resD1 = await db.query(`
    select public.reserve_trial_credit($1, 'evaluate_answer', 'input_d', $2, 500) as r;
  `, [taskIdD, userIdA]);
  const tokenD1 = resD1.rows[0].r.lease_token;
  const remBefore = resD1.rows[0].r.remaining;
  console.log(`✓ Reserved task D (remaining=${remBefore}, token=${tokenD1})`);

  // Release / Refund
  const resD2 = await db.query(`
    select public.release_trial_credit($1, 'AI_TIMEOUT', $2, $3) as r;
  `, [taskIdD, userIdA, tokenD1]);
  if (!resD2.rows[0].r.success || resD2.rows[0].r.refunded !== true) {
    throw new Error(`Refund failed: ${JSON.stringify(resD2.rows[0].r)}`);
  }
  console.log(`✓ Refunded task D: balance restored to ${resD2.rows[0].r.balance}`);

  // Retry reserve on refunded task
  const resD3 = await db.query(`
    select public.reserve_trial_credit($1, 'evaluate_answer', 'input_d', $2, 500) as r;
  `, [taskIdD, userIdA]);
  if (!resD3.rows[0].r.allowed || resD3.rows[0].r.status !== 'processing') {
    throw new Error(`Retry after refund failed: ${JSON.stringify(resD3.rows[0].r)}`);
  }
  const tokenD2 = resD3.rows[0].r.lease_token;
  if (tokenD1 === tokenD2) {
    throw new Error('Fresh lease token must be generated upon retry');
  }
  console.log(`✓ Successfully re-reserved refunded task D with fresh lease token ${tokenD2}`);

  // --------------------------------------------------------------------------
  // Scenario E: Stale Fencing Lease Token Rejection
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario E: Stale Fencing Lease Token Rejection ---');
  // Attempt to record result or settle with OLD tokenD1 on task D
  const staleRecord = await db.query(`
    select public.record_trial_result_ready($1, '{"eval":"ok"}'::jsonb, $2, $3) as r;
  `, [taskIdD, userIdA, tokenD1]);
  if (staleRecord.rows[0].r.success !== false || staleRecord.rows[0].r.error_code !== 'STALE_LEASE_TOKEN') {
    throw new Error(`Expected STALE_LEASE_TOKEN for old token, got: ${JSON.stringify(staleRecord.rows[0].r)}`);
  }

  const staleSettle = await db.query(`
    select public.settle_trial_credit($1, $2, $3) as r;
  `, [taskIdD, userIdA, tokenD1]);
  if (staleSettle.rows[0].r.success !== false || staleSettle.rows[0].r.error_code !== 'STALE_LEASE_TOKEN') {
    throw new Error(`Expected STALE_LEASE_TOKEN for settle, got: ${JSON.stringify(staleSettle.rows[0].r)}`);
  }

  const staleRelease = await db.query(`
    select public.release_trial_credit($1, 'fail', $2, $3) as r;
  `, [taskIdD, userIdA, tokenD1]);
  if (staleRelease.rows[0].r.success !== false || staleRelease.rows[0].r.error_code !== 'STALE_LEASE_TOKEN') {
    throw new Error(`Expected STALE_LEASE_TOKEN for release, got: ${JSON.stringify(staleRelease.rows[0].r)}`);
  }
  console.log('✓ Stale fencing lease tokens strictly rejected across record, settle, and release');

  // --------------------------------------------------------------------------
  // Scenario F: Idempotency under Network Drop / Repetition
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario F: Idempotency under Network Drop / Repetition ---');
  // Record valid result with tokenD2 and settle
  await db.query(`
    select public.record_trial_result_ready($1, '{"eval":"valid"}'::jsonb, $2, $3);
  `, [taskIdD, userIdA, tokenD2]);
  const settle1 = await db.query(`
    select public.settle_trial_credit($1, $2, $3) as r;
  `, [taskIdD, userIdA, tokenD2]);
  if (!settle1.rows[0].r.success || settle1.rows[0].r.status !== 'settled') {
    throw new Error(`First settle failed: ${JSON.stringify(settle1.rows[0].r)}`);
  }

  // 1. Double Settle Retry with same token (Simulating network response loss): MUST SUCCEED READ-ONLY!
  const settleRetry = await db.query(`
    select public.settle_trial_credit($1, $2, $3) as r;
  `, [taskIdD, userIdA, tokenD2]);
  if (settleRetry.rows[0].r.success !== true || settleRetry.rows[0].r.status !== 'settled') {
    throw new Error(`Double settle retry failed (expected success:true, got: ${JSON.stringify(settleRetry.rows[0].r)})`);
  }
  console.log('✓ Idempotent settle retry succeeded read-only with same token after response loss');

  // 2. Cross-user settle attempt: MUST BE REJECTED
  const crossUserSettle = await db.query(`
    select public.settle_trial_credit($1, $2, $3) as r;
  `, [taskIdD, userIdB, tokenD2]);
  if (crossUserSettle.rows[0].r.success !== false || crossUserSettle.rows[0].r.error_code !== 'TASK_OWNERSHIP_MISMATCH') {
    throw new Error(`Cross-user settle should fail with TASK_OWNERSHIP_MISMATCH: ${JSON.stringify(crossUserSettle.rows[0].r)}`);
  }
  console.log('✓ Cross-user settle attempt strictly rejected with TASK_OWNERSHIP_MISMATCH');

  // 3. Settled task refund attempt: MUST BE BLOCKED
  const refundSettled = await db.query(`
    select public.release_trial_credit($1, 'should_fail', $2, $3) as r;
  `, [taskIdD, userIdA, tokenD2]);
  if (refundSettled.rows[0].r.success !== false || refundSettled.rows[0].r.error_code !== 'ALREADY_SETTLED') {
    throw new Error(`Refunding a settled task must fail with ALREADY_SETTLED: ${JSON.stringify(refundSettled.rows[0].r)}`);
  }
  console.log('✓ Attempt to refund a settled task properly blocked with ALREADY_SETTLED');

  // 4. Double Release / Refund Retry (Simulating network response loss):
  await db.query(`update public.ai_trial_credits set balance = 1 where user_id = $1;`, [userIdA]);
  const taskIdE = 'task_e_' + Date.now();
  const resE1 = await db.query(`
    select public.reserve_trial_credit($1, 'generate_problems', 'input_e', $2, 500) as r;
  `, [taskIdE, userIdA]);
  if (!resE1.rows[0].r.allowed) {
    throw new Error(`Reservation for task E failed: ${JSON.stringify(resE1.rows[0].r)}`);
  }
  const tokenE = resE1.rows[0].r.lease_token;

  // First release
  const rel1 = await db.query(`
    select public.release_trial_credit($1, 'cancelled', $2, $3) as r;
  `, [taskIdE, userIdA, tokenE]);
  if (!rel1.rows[0].r.success || rel1.rows[0].r.refunded !== true) {
    throw new Error(`First release failed: ${JSON.stringify(rel1.rows[0].r)}`);
  }
  const balAfterE = rel1.rows[0].r.balance;

  // Retry release with same token
  const relRetry = await db.query(`
    select public.release_trial_credit($1, 'cancelled', $2, $3) as r;
  `, [taskIdE, userIdA, tokenE]);
  if (relRetry.rows[0].r.success !== true || relRetry.rows[0].r.refunded !== false || relRetry.rows[0].r.balance !== balAfterE) {
    throw new Error(`Release retry failed: ${JSON.stringify(relRetry.rows[0].r)}`);
  }
  console.log('✓ Idempotent release retry succeeded read-only with same token (refunded=false, balance unmutated)');

  // 5. Attempting to settle a refunded task: MUST BE BLOCKED
  const settleRefunded = await db.query(`
    select public.settle_trial_credit($1, $2, $3) as r;
  `, [taskIdE, userIdA, tokenE]);
  if (settleRefunded.rows[0].r.success !== false || settleRefunded.rows[0].r.error_code !== 'ALREADY_REFUNDED') {
    throw new Error(`Settling a refunded task must fail with ALREADY_REFUNDED: ${JSON.stringify(settleRefunded.rows[0].r)}`);
  }
  console.log('✓ Attempt to settle a refunded task properly blocked with ALREADY_REFUNDED');

  // 6. Repeated reserve
  const repReserve = await db.query(`
    select public.reserve_trial_credit($1, 'evaluate_answer', 'input_d', $2, 500) as r;
  `, [taskIdD, userIdA]);
  if (repReserve.rows[0].r.allowed !== false || repReserve.rows[0].r.status !== 'already_completed') {
    throw new Error(`Repeated reserve did not return already_completed: ${JSON.stringify(repReserve.rows[0].r)}`);
  }
  console.log('✓ Repeated reserve on settled task safely returns already_completed without credit mutation');

  // --------------------------------------------------------------------------
  // Scenario G: Permission Lockdown (Authenticated users CANNOT call service_role RPCs)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario G: Permission Lockdown for Non-service_role ---');
  await setAuthContext(db, { uid: userIdA, role: 'authenticated' });

  const authSettle = await db.query(`
    select public.settle_trial_credit($1, $2, $3) as r;
  `, [taskIdA, userIdA, leaseTokenA]);
  if (authSettle.rows[0].r.success !== false || authSettle.rows[0].r.error_code !== 'UNAUTHORIZED') {
    throw new Error(`Authenticated role must be rejected for settle: ${JSON.stringify(authSettle.rows[0].r)}`);
  }

  const authRecord = await db.query(`
    select public.record_trial_result_ready($1, '{}'::jsonb, $2, $3) as r;
  `, [taskIdA, userIdA, leaseTokenA]);
  if (authRecord.rows[0].r.success !== false || authRecord.rows[0].r.error_code !== 'UNAUTHORIZED') {
    throw new Error(`Authenticated role must be rejected for record: ${JSON.stringify(authRecord.rows[0].r)}`);
  }
  console.log('✓ Normal authenticated users blocked from direct execution of service_role RPCs');

  // --------------------------------------------------------------------------
  // Scenario H: Unified Task Registration & Save Retry Lookup (Migration 31)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario H: Unified Task Registration & Save Retry Lookup (Migration 31) ---');
  await setAuthContext(db, { uid: userIdA, role: 'service_role' });

  // 1. Personal key registration does not deduct trial credits
  const beforeCredits = (await db.query(`select balance from public.ai_trial_credits where user_id = $1;`, [userIdA])).rows[0].balance;
  const taskP1 = 'task_personal_001';
  const regPersonal = await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'hash_math_01', $2, true, 500) as r;
  `, [taskP1, userIdA]);
  const resP1 = regPersonal.rows[0].r;
  if (!resP1.allowed || resP1.credit_source !== 'personal_key') {
    throw new Error(`Personal key registration failed: ${JSON.stringify(resP1)}`);
  }
  const afterCredits = (await db.query(`select balance from public.ai_trial_credits where user_id = $1;`, [userIdA])).rows[0].balance;
  if (beforeCredits !== afterCredits) {
    throw new Error(`Personal key registration must not mutate trial credit balance (${beforeCredits} -> ${afterCredits})`);
  }
  console.log('✓ Personal key registration succeeds without trial balance mutation');

  // 2. Input mismatch rejection on same taskId
  const regMismatch = await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'DIFFERENT_HASH', $2, true, 500) as r;
  `, [taskP1, userIdA]);
  if (regMismatch.rows[0].r.allowed !== false || regMismatch.rows[0].r.error_code !== 'TASK_INPUT_MISMATCH') {
    throw new Error(`Different input on same taskId must be rejected with TASK_INPUT_MISMATCH: ${JSON.stringify(regMismatch.rows[0].r)}`);
  }
  console.log('✓ Same taskId with different input correctly rejected with TASK_INPUT_MISMATCH');

  // 3. Ownership mismatch rejection
  const regOwnerMismatch = await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'hash_math_01', $2, true, 500) as r;
  `, [taskP1, userIdB]);
  if (regOwnerMismatch.rows[0].r.allowed !== false || regOwnerMismatch.rows[0].r.error_code !== 'TASK_OWNERSHIP_MISMATCH') {
    throw new Error(`Different user on same taskId must be rejected with TASK_OWNERSHIP_MISMATCH: ${JSON.stringify(regOwnerMismatch.rows[0].r)}`);
  }
  console.log('✓ Reusing another user taskId correctly rejected with TASK_OWNERSHIP_MISMATCH');

  // 4. Concurrent execution blocked while lease is active
  const regConcurrent = await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'hash_math_01', $2, true, 500) as r;
  `, [taskP1, userIdA]);
  if (regConcurrent.rows[0].r.status !== 'concurrent_in_progress') {
    throw new Error(`Concurrent execution must return concurrent_in_progress: ${JSON.stringify(regConcurrent.rows[0].r)}`);
  }
  console.log('✓ Duplicate execution during active lease correctly blocked with concurrent_in_progress');

  // 5. Record result ready
  await db.query(`
    select public.record_trial_result_ready($1, '{"problems":[{"id":"p1"}]}'::jsonb, $2, $3);
  `, [taskP1, userIdA, resP1.lease_token]);

  // 6. lookup_saved_ai_task_result succeeds with preserved result
  const lookupSuccess = await db.query(`
    select public.lookup_saved_ai_task_result($1, $2, 'generate_problems', 'hash_math_01') as r;
  `, [taskP1, userIdA]);
  if (!lookupSuccess.rows[0].r.success || !lookupSuccess.rows[0].r.cached_result) {
    throw new Error(`Saved task lookup must return preserved result: ${JSON.stringify(lookupSuccess.rows[0].r)}`);
  }
  console.log('✓ lookup_saved_ai_task_result authoritative retrieval of preserved result verified');

  // --------------------------------------------------------------------------
  // Scenario I: Autonomous Credit Initialization on Reservation (Problem 2)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario I: Autonomous Credit Initialization on Reservation (Problem 2) ---');
  const userNormalNew = '33333333-3333-3333-3333-333333333333';
  const userGuestNew = '44444444-4444-4444-4444-444444444444';

  await db.query(`
    insert into auth.users (id, email, raw_user_meta_data)
    values ($1, 'normal_new@example.com', '{"auth_type":"email"}'::jsonb),
           ($2, 'guest_new@id.learnaway.local', '{"auth_type":"username"}'::jsonb);
  `, [userNormalNew, userGuestNew]);

  // Normal user calls register_ai_task FIRST (without prior get_or_create_trial_credits)
  const normReg = await db.query(`
    select public.register_ai_task('task_auto_norm_01', 'evaluate_answer', 'hash_norm_01', $1, false, 500) as r;
  `, [userNormalNew]);
  const normData = normReg.rows[0].r;
  if (!normData.allowed || normData.remaining !== 2 || normData.status !== 'processing') {
    throw new Error(`Scenario I normal user auto-init failed: ${JSON.stringify(normData)}`);
  }
  const normRow = (await db.query(`select granted_credits, balance from public.ai_trial_credits where user_id = $1;`, [userNormalNew])).rows[0];
  if (normRow.granted_credits !== 3 || normRow.balance !== 2) {
    throw new Error(`Scenario I normal user credit row mismatch: ${JSON.stringify(normRow)}`);
  }
  console.log('✓ Normal user atomically initialized with 3 credits and 1 reserved (remaining=2)');

  // Guest user calls register_ai_task FIRST
  const guestReg = await db.query(`
    select public.register_ai_task('task_auto_guest_01', 'evaluate_answer', 'hash_guest_01', $1, false, 500) as r;
  `, [userGuestNew]);
  const guestData = guestReg.rows[0].r;
  if (!guestData.allowed || guestData.remaining !== 0 || guestData.status !== 'processing') {
    throw new Error(`Scenario I guest user auto-init failed: ${JSON.stringify(guestData)}`);
  }
  const guestRow = (await db.query(`select granted_credits, balance from public.ai_trial_credits where user_id = $1;`, [userGuestNew])).rows[0];
  if (guestRow.granted_credits !== 1 || guestRow.balance !== 0) {
    throw new Error(`Scenario I guest user credit row mismatch: ${JSON.stringify(guestRow)}`);
  }
  console.log('✓ Guest user atomically initialized with 1 credit and 1 reserved (remaining=0)');

  // Querying get_or_create_trial_credits subsequently MUST NOT overwrite balance or re-grant
  const normCheck = (await db.query(`select public.get_or_create_trial_credits($1) as r;`, [userNormalNew])).rows[0].r;
  if (normCheck.balance !== 2 || normCheck.granted !== 3) {
    throw new Error(`Subsequent get_or_create overwrote balance: ${JSON.stringify(normCheck)}`);
  }
  console.log('✓ Subsequent credit query preserves existing balance without re-granting');

  // --------------------------------------------------------------------------
  // Scenario J: Task Retry Budget & Atomic Deduction Enforcement (Problem 1)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario J: Task Retry Budget & Atomic Deduction Enforcement (Problem 1) ---');
  const taskIdJ = 'task_retry_p1_' + Date.now();
  // 1. Initial reservation: balance 2 -> 1
  const jRes1 = (await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'hash_j_01', $2, false, 500) as r;
  `, [taskIdJ, userNormalNew])).rows[0].r;
  if (!jRes1.allowed || jRes1.remaining !== 1) {
    throw new Error(`Initial reservation failed: ${JSON.stringify(jRes1)}`);
  }
  const jToken1 = jRes1.lease_token;

  // 2. Failure refund: balance 1 -> 2, status -> failed_refunded
  const jRel1 = (await db.query(`
    select public.release_trial_credit($1, 'AI_GATEWAY_TIMEOUT', $2, $3) as r;
  `, [taskIdJ, userNormalNew, jToken1])).rows[0].r;
  if (!jRel1.success || !jRel1.refunded || jRel1.balance !== 2) {
    throw new Error(`Scenario J refund failed: ${JSON.stringify(jRel1)}`);
  }
  console.log('✓ Task released with refund: balance restored to 2');

  // 3. Retry same task: MUST atomically deduct balance (2 -> 1)
  const jRetry1 = (await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'hash_j_01', $2, false, 500) as r;
  `, [taskIdJ, userNormalNew])).rows[0].r;
  if (!jRetry1.allowed || jRetry1.remaining !== 1 || jRetry1.status !== 'processing') {
    throw new Error(`Scenario J retry failed: ${JSON.stringify(jRetry1)}`);
  }
  const jBalAfterRetry1 = (await db.query(`select balance from public.ai_trial_credits where user_id = $1;`, [userNormalNew])).rows[0].balance;
  if (jBalAfterRetry1 !== 1) {
    throw new Error(`Expected balance 1 after retry deduction, got ${jBalAfterRetry1}`);
  }
  const jAttemptRow = (await db.query(`select attempt_count from public.ai_trial_reservations where task_id = $1;`, [taskIdJ])).rows[0];
  if (jAttemptRow.attempt_count !== 2) {
    throw new Error(`Expected attempt_count 2, got ${jAttemptRow.attempt_count}`);
  }
  console.log('✓ Retry on failed_refunded task atomically deducted balance (2 -> 1) and incremented attempt_count to 2');

  // 4. Release again and simulate zero balance
  const jToken2 = jRetry1.lease_token;
  await db.query(`select public.release_trial_credit($1, 'AI_PARSE_ERROR', $2, $3);`, [taskIdJ, userNormalNew, jToken2]);
  await db.query(`update public.ai_trial_credits set balance = 0 where user_id = $1;`, [userNormalNew]);

  // 5. Retry when balance is 0: MUST be rejected with INSUFFICIENT_CREDITS
  const jRetryNoBal = (await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'hash_j_01', $2, false, 500) as r;
  `, [taskIdJ, userNormalNew])).rows[0].r;
  if (jRetryNoBal.allowed !== false || jRetryNoBal.error_code !== 'INSUFFICIENT_CREDITS') {
    throw new Error(`Retry with zero balance must be rejected with INSUFFICIENT_CREDITS: ${JSON.stringify(jRetryNoBal)}`);
  }
  console.log('✓ Retry on refunded task with 0 balance rejected with INSUFFICIENT_CREDITS');

  // 6. Restore balance=2, simulate daily limit reached (call_count = 500)
  await db.query(`update public.ai_trial_credits set balance = 2 where user_id = $1;`, [userNormalNew]);
  await db.query(`
    insert into public.operator_ai_daily_usage (usage_date, call_count)
    values (current_date, 500)
    on conflict (usage_date) do update set call_count = 500;
  `);

  // Retry when daily limit exceeded: MUST be rejected with OPERATOR_DAILY_CAP_EXCEEDED
  const jRetryLimit = (await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'hash_j_01', $2, false, 500) as r;
  `, [taskIdJ, userNormalNew])).rows[0].r;
  if (jRetryLimit.allowed !== false || jRetryLimit.error_code !== 'OPERATOR_DAILY_CAP_EXCEEDED') {
    throw new Error(`Retry with daily cap reached must fail with OPERATOR_DAILY_CAP_EXCEEDED: ${JSON.stringify(jRetryLimit)}`);
  }
  // Verify daily usage not inflated on rejection and balance untouched
  const jUsageAfter = (await db.query(`select call_count from public.operator_ai_daily_usage where usage_date = current_date;`)).rows[0].call_count;
  const jBalAfterCap = (await db.query(`select balance from public.ai_trial_credits where user_id = $1;`, [userNormalNew])).rows[0].balance;
  if (jUsageAfter !== 500 || jBalAfterCap !== 2) {
    throw new Error(`Rejected retry mutated balance or daily usage: bal=${jBalAfterCap}, usage=${jUsageAfter}`);
  }
  console.log('✓ Retry rejected on OPERATOR_DAILY_CAP_EXCEEDED without inflating usage or deducting balance');

  // Reset daily usage to 10
  await db.query(`update public.operator_ai_daily_usage set call_count = 10 where usage_date = current_date;`);

  // 7. Max retries exceeded (attempt_count >= 5)
  await db.query(`update public.ai_trial_reservations set attempt_count = 5 where task_id = $1;`, [taskIdJ]);
  const jRetryMax = (await db.query(`
    select public.register_ai_task($1, 'generate_problems', 'hash_j_01', $2, false, 500) as r;
  `, [taskIdJ, userNormalNew])).rows[0].r;
  if (jRetryMax.allowed !== false || jRetryMax.error_code !== 'MAX_RETRIES_EXCEEDED') {
    throw new Error(`Attempt count >= 5 must fail with MAX_RETRIES_EXCEEDED: ${JSON.stringify(jRetryMax)}`);
  }
  console.log('✓ Retry rejected with MAX_RETRIES_EXCEEDED when attempt_count >= 5');

  // 8. Expired lease retry on 'processing' task: NO double credit deduction, but AI budget applied
  const taskIdJ2 = 'task_lease_exp_' + Date.now();
  await db.query(`
    select public.register_ai_task($1, 'evaluate_answer', 'hash_j_02', $2, false, 500) as r;
  `, [taskIdJ2, userNormalNew]);
  // balance: 2 -> 1
  // Expire lease
  await db.query(`
    update public.ai_trial_reservations
    set lease_expires_at = now() - interval '1 minute'
    where task_id = $1;
  `, [taskIdJ2]);

  const balBeforeExpRetry = (await db.query(`select balance from public.ai_trial_credits where user_id = $1;`, [userNormalNew])).rows[0].balance;
  const jExpRetry = (await db.query(`
    select public.register_ai_task($1, 'evaluate_answer', 'hash_j_02', $2, false, 500) as r;
  `, [taskIdJ2, userNormalNew])).rows[0].r;
  if (!jExpRetry.allowed || jExpRetry.status !== 'processing') {
    throw new Error(`Expired lease retry failed: ${JSON.stringify(jExpRetry)}`);
  }
  const jExpAttempt = (await db.query(`select attempt_count from public.ai_trial_reservations where task_id = $1;`, [taskIdJ2])).rows[0];
  if (jExpAttempt.attempt_count !== 2) {
    throw new Error(`Expected attempt_count 2 for expired lease retry, got ${jExpAttempt.attempt_count}`);
  }
  const balAfterExpRetry = (await db.query(`select balance from public.ai_trial_credits where user_id = $1;`, [userNormalNew])).rows[0].balance;
  if (balBeforeExpRetry !== balAfterExpRetry) {
    throw new Error(`Expired lease retry must NOT double deduct balance (${balBeforeExpRetry} vs ${balAfterExpRetry})`);
  }
  console.log('✓ Expired lease retry preserved balance without double deduction, issued fresh lease token and incremented attempt_count');

  // --------------------------------------------------------------------------
  // Scenario K: Credit Source Mismatch & Personal Key Refund Safety (Problems 1 & 3)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario K: Credit Source Mismatch & Personal Key Refund Safety (Problems 1 & 3) ---');
  const taskPk = 'task_k_pk_' + Date.now();
  // 1. Register with personal_key
  const kPkReg = (await db.query(`
    select public.register_ai_task($1, 'analyze_concepts', 'hash_k_01', $2, true, 500) as r;
  `, [taskPk, userNormalNew])).rows[0].r;
  if (!kPkReg.allowed || kPkReg.credit_source !== 'personal_key') {
    throw new Error(`PK registration failed: ${JSON.stringify(kPkReg)}`);
  }
  const pkToken = kPkReg.lease_token;

  // 2. Attempt to re-register personal_key task as operator_trial: MUST FAIL
  const kMismatch1 = (await db.query(`
    select public.register_ai_task($1, 'analyze_concepts', 'hash_k_01', $2, false, 500) as r;
  `, [taskPk, userNormalNew])).rows[0].r;
  if (kMismatch1.allowed !== false || kMismatch1.error_code !== 'TASK_CREDIT_SOURCE_MISMATCH') {
    throw new Error(`Expected TASK_CREDIT_SOURCE_MISMATCH, got: ${JSON.stringify(kMismatch1)}`);
  }
  console.log('✓ Switching personal_key task to operator_trial rejected with TASK_CREDIT_SOURCE_MISMATCH');

  // 3. Attempt to re-register operator_trial task as personal_key: MUST FAIL
  const kMismatch2 = (await db.query(`
    select public.register_ai_task($1, 'evaluate_answer', 'hash_j_02', $2, true, 500) as r;
  `, [taskIdJ2, userNormalNew])).rows[0].r;
  if (kMismatch2.allowed !== false || kMismatch2.error_code !== 'TASK_CREDIT_SOURCE_MISMATCH') {
    throw new Error(`Expected TASK_CREDIT_SOURCE_MISMATCH, got: ${JSON.stringify(kMismatch2)}`);
  }
  console.log('✓ Switching operator_trial task to personal_key rejected with TASK_CREDIT_SOURCE_MISMATCH');

  // 4. Release personal_key task: MUST NOT increment trial credits!
  const balBeforePkRel = (await db.query(`select balance from public.ai_trial_credits where user_id = $1;`, [userNormalNew])).rows[0].balance;
  const kPkRel = (await db.query(`
    select public.release_trial_credit($1, 'USER_ABORT', $2, $3) as r;
  `, [taskPk, userNormalNew, pkToken])).rows[0].r;
  if (!kPkRel.success || kPkRel.refunded !== false) {
    throw new Error(`Personal key release should have refunded=false: ${JSON.stringify(kPkRel)}`);
  }
  const balAfterPkRel = (await db.query(`select balance from public.ai_trial_credits where user_id = $1;`, [userNormalNew])).rows[0].balance;
  if (balBeforePkRel !== balAfterPkRel) {
    throw new Error(`Personal key release must NEVER inflate trial credit balance (${balBeforePkRel} -> ${balAfterPkRel})`);
  }
  console.log('✓ Releasing personal_key task safely released without trial balance inflation (refunded=false)');

  // 5. clear_ai_task_lease for intermediate chunk progress
  const taskChunk = 'task_chunk_' + Date.now();
  const chunkInit = (await db.query(`
    select public.register_ai_task($1, 'analyze_concepts', 'hash_chunk_01', $2, true, 500) as r;
  `, [taskChunk, userNormalNew])).rows[0].r;
  const chunkToken = chunkInit.lease_token;

  // Normal immediate next chunk request would be blocked by CONCURRENT_EXECUTION_BLOCKED while lease active
  const chunkBlocked = (await db.query(`
    select public.register_ai_task($1, 'analyze_concepts', 'hash_chunk_01', $2, true, 500) as r;
  `, [taskChunk, userNormalNew])).rows[0].r;
  if (chunkBlocked.status !== 'concurrent_in_progress') {
    throw new Error(`Active chunk lease must block duplicate: ${JSON.stringify(chunkBlocked)}`);
  }

  // Clear lease upon intermediate chunk finish
  const clearRes = (await db.query(`
    select public.clear_ai_task_lease($1, $2, $3) as r;
  `, [taskChunk, userNormalNew, chunkToken])).rows[0].r;
  if (!clearRes.success) {
    throw new Error(`clear_ai_task_lease failed: ${JSON.stringify(clearRes)}`);
  }
  const chunkRow = (await db.query(`select status, lease_token, lease_expires_at from public.ai_trial_reservations where task_id = $1;`, [taskChunk])).rows[0];
  if (chunkRow.status !== 'processing' || chunkRow.lease_token !== null) {
    throw new Error(`clear_ai_task_lease did not clear lease correctly: ${JSON.stringify(chunkRow)}`);
  }

  // Now next chunk can register immediately without being blocked!
  const chunkNext = (await db.query(`
    select public.register_ai_task($1, 'analyze_concepts', 'hash_chunk_01', $2, true, 500) as r;
  `, [taskChunk, userNormalNew])).rows[0].r;
  if (!chunkNext.allowed || chunkNext.status !== 'processing') {
    throw new Error(`Next chunk failed to register after clear_ai_task_lease: ${JSON.stringify(chunkNext)}`);
  }
  console.log('✓ clear_ai_task_lease enables smooth sequential multi-chunk execution without 409 collisions');

  // --------------------------------------------------------------------------
  // Scenario L: Telemetry Authoritative Aggregation & Permission Lockdown (Problem 4)
  // --------------------------------------------------------------------------
  console.log('\n--- Scenario L: Telemetry Authoritative Aggregation & Permission Lockdown (Problem 4) ---');
  // 1. Insert 60 rows for userIdA, 10 rows for userIdB
  await db.query(`
    insert into public.ai_usage_telemetry (
      request_id, user_id, task_type, credit_source, provider, model, input_tokens, output_tokens, total_tokens,
      estimated_cost_usd, estimated_cost_krw, status, execution_time_ms, created_at
    )
    select
      'req_a_' || i,
      $1,
      case when i % 2 = 0 then 'evaluate_answer' else 'generate_problems' end,
      'operator_trial',
      'school_gateway',
      'deepseek-v4.1-flash',
      100,
      50,
      150,
      0.001,
      1.4,
      'success',
      300,
      now() - (i || ' minutes')::interval
    from generate_series(1, 60) as i;
  `, [userIdA]);

  await db.query(`
    insert into public.ai_usage_telemetry (
      request_id, user_id, task_type, credit_source, provider, model, input_tokens, output_tokens, total_tokens,
      estimated_cost_usd, estimated_cost_krw, status, execution_time_ms, created_at
    )
    select
      'req_b_' || i,
      $1,
      'evaluate_answer',
      'personal_key',
      'openai',
      'gpt-4o',
      200,
      100,
      300,
      0.005,
      7.0,
      'success',
      400,
      now() - (i || ' minutes')::interval
    from generate_series(1, 10) as i;
  `, [userIdB]);

  // 2. Call aggregate_ai_usage_telemetry for userIdA
  const aggA = (await db.query(`
    select public.aggregate_ai_usage_telemetry($1, null, null, null, null, null) as r;
  `, [userIdA])).rows[0].r;
  if (aggA.totalRequests !== 60 || aggA.operatorTrialConsumption.tokens !== 9000) {
    throw new Error(`Scenario L userIdA aggregation failed: ${JSON.stringify(aggA)}`);
  }
  console.log(`✓ Aggregate for 60 rows correctly returns totalRequests=60, operatorTrialTokens=${aggA.operatorTrialConsumption.tokens}`);

  // 3. User isolation: userIdB only sees 10 rows
  const aggB = (await db.query(`
    select public.aggregate_ai_usage_telemetry($1, null, null, null, null, null) as r;
  `, [userIdB])).rows[0].r;
  if (aggB.totalRequests !== 10 || aggB.personalKeyConsumption.tokens !== 3000) {
    throw new Error(`Scenario L userIdB aggregation failed: ${JSON.stringify(aggB)}`);
  }
  console.log(`✓ Aggregate for userIdB returns isolated totalRequests=10, personalKeyTokens=3000`);

  // 4. Filtered aggregation (e.g. task_type = 'evaluate_answer' for userIdA -> 30 rows)
  const aggFiltered = (await db.query(`
    select public.aggregate_ai_usage_telemetry($1, 'evaluate_answer', null, null, null, null) as r;
  `, [userIdA])).rows[0].r;
  if (aggFiltered.totalRequests !== 30) {
    throw new Error(`Scenario L filtered aggregation failed: ${JSON.stringify(aggFiltered)}`);
  }
  console.log(`✓ Filtered aggregation accurately counts 30 evaluate_answer rows`);

  // 5. Admin role aggregate without userId sees all 70 rows
  const aggAll = (await db.query(`
    select public.aggregate_ai_usage_telemetry(null, null, null, null, null, null) as r;
  `)).rows[0].r;
  if (aggAll.totalRequests !== 70) {
    throw new Error(`Admin global aggregation failed: ${JSON.stringify(aggAll)}`);
  }
  console.log(`✓ Admin aggregate across all users returns complete totalRequests=70`);

  // 6. Permission lockdown: authenticated role CANNOT call aggregate_ai_usage_telemetry or clear_ai_task_lease
  await setAuthContext(db, { uid: userIdA, role: 'authenticated' });
  const unauthAgg = (await db.query(`
    select public.aggregate_ai_usage_telemetry($1, null, null, null, null, null) as r;
  `, [userIdA])).rows[0].r;
  if (unauthAgg.error_code !== 'UNAUTHORIZED') {
    throw new Error(`Authenticated user calling aggregate RPC must be rejected: ${JSON.stringify(unauthAgg)}`);
  }
  const unauthClear = (await db.query(`
    select public.clear_ai_task_lease('any_task', $1, 'any_token') as r;
  `, [userIdA])).rows[0].r;
  if (unauthClear.error_code !== 'UNAUTHORIZED') {
    throw new Error(`Authenticated user calling clear_ai_task_lease must be rejected: ${JSON.stringify(unauthClear)}`);
  }
  console.log('✓ Permission lockdown strictly verified for aggregate_ai_usage_telemetry and clear_ai_task_lease');

  console.log('\n=== All Upgrade Path & Scenario Tests Passed Successfully! ===\n');
}

async function testFreshInstallPath() {
  console.log('=== [2] Testing Fresh Install Path: Clean DB -> Run All Migrations (00~32) ===');
  const db = new PGlite();
  await setupSupabaseMocks(db);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    await runSqlFile(db, path.join(MIGRATIONS_DIR, f));
  }
  console.log(`✓ Successfully applied all ${files.length} migrations from 00 to 32 on clean database`);
}

async function main() {
  try {
    await testUpgradePath();
    await testFreshInstallPath();
    console.log('🎉 ALL PGLITE MIGRATION & RPC VERIFICATIONS PASSED 100%!');
  } catch (err) {
    console.error('❌ Verification failed with error:', err.message, 'Code:', err.code);
    if (err.detail) console.error('Detail:', err.detail);
    if (err.hint) console.error('Hint:', err.hint);
    process.exit(1);
  }
}

main();
