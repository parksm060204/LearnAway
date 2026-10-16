-- ============================================================================
-- Temporary PDF Conversion Storage Policies and Path Conventions
--
-- For precision server conversions of large PDF files (> 4.5MB), files are
-- uploaded directly to Supabase Storage:
--   Bucket: 'materials'
--   Object Path: <auth.uid()>/temp-convert/<job_id>/<file_name>.pdf
--
-- Invariants:
-- 1. Strict Owner Isolation: The first path segment is auth.uid()::text,
--    enforced by existing materials_objects_* policies.
-- 2. Transience: Temporary files are downloaded by the conversion service
--    via short-lived signed URLs and automatically removed immediately
--    upon completion or error.
-- 3. Non-Permanent: Temporary upload does not imply consent for permanent backup.
-- ============================================================================

-- Add a comment to explicitly document the temp-convert prefix in the materials bucket
comment on table storage.objects is
  'LearnAway private materials bucket with isolated user namespaces (<auth.uid()>/materials, <auth.uid()>/temp-convert)';
