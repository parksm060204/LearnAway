-- ============================================================================
-- Private Storage bucket for material originals and parsed bodies.
--
-- Object layout (path inside the bucket):
--   <auth.uid()>/<material_id>/v<version>/original.<ext>
--   <auth.uid()>/<material_id>/v<version>/transcript.txt
--   <auth.uid()>/<material_id>/v<version>/markdown.md
--   <auth.uid()>/<material_id>/v<version>/pages.json
--
-- Access is owner-only. The first path segment must equal the caller's uid, so
-- a forged path can never read or write another user's objects.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists materials_objects_select_own on storage.objects;
drop policy if exists materials_objects_insert_own on storage.objects;
drop policy if exists materials_objects_update_own on storage.objects;
drop policy if exists materials_objects_delete_own on storage.objects;

create policy materials_objects_select_own on storage.objects
  for select using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy materials_objects_insert_own on storage.objects
  for insert with check (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy materials_objects_update_own on storage.objects
  for update using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy materials_objects_delete_own on storage.objects
  for delete using (
    bucket_id = 'materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
