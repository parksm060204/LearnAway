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
  console.log('=== [1] Testing Upgrade Path: DB with Migrations 00~27 -> Apply Migration 28 ===');
  const db = new PGlite();
  await setupSupabaseMocks(db);

  // 1. Run migrations 00 to 27
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  const upTo27 = files.filter(f => !f.includes('000028_'));

  for (const f of upTo27) {
    // console.log(`Applying ${f}...`);
    await runSqlFile(db, path.join(MIGRATIONS_DIR, f));
  }
  console.log(`✓ Successfully applied ${upTo27.length} migrations up to 27`);

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

  // 3. Apply Migration 28 (Should succeed with ZERO 42P13 / 42725 errors!)
  const migration28File = files.find(f => f.includes('000028_'));
  console.log(`Applying Migration 28: ${migration28File}...`);
  await runSqlFile(db, path.join(MIGRATIONS_DIR, migration28File));
  console.log('✓ Migration 28 executed cleanly without 42P13 or 42725 errors!');

  // Now execute Scenarios A through F
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
  await db.query(`
    select public.settle_trial_credit($1, $2, $3);
  `, [taskIdD, userIdA, tokenD2]);

  // Repeated settle
  await db.query(`
    select public.settle_trial_credit($1, $2, $3) as r;
  `, [taskIdD, userIdA, tokenD2]);
  // Note: after settle, lease_token is null in DB, or it can be called with same token
  // Let's test repeated reserve
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

  console.log('\n=== All Upgrade Path & Scenario Tests Passed Successfully! ===\n');
}

async function testFreshInstallPath() {
  console.log('=== [2] Testing Fresh Install Path: Clean DB -> Run All Migrations (00~28) ===');
  const db = new PGlite();
  await setupSupabaseMocks(db);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    await runSqlFile(db, path.join(MIGRATIONS_DIR, f));
  }
  console.log(`✓ Successfully applied all ${files.length} migrations from 00 to 28 on clean database`);
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
