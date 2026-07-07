-- ============================================================================
-- VanGo migration_006: allow client photo uploads to the job-photos bucket
-- Run this in Supabase Dashboard -> SQL Editor -> New Query -> Run
--
-- WHY: the job-photos bucket is public for READING, but Storage still needs
-- an explicit RLS policy on storage.objects before clients can UPLOAD.
-- Without it every upload fails:
--   - customer item photos on the post page failed silently (job posted with
--     no photo, so drivers saw nothing), and
--   - driver proof photos failed loudly ("Could not upload the photo"),
--     which blocked the photo-gated pickup/delivery flow entirely.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- Any signed-in user can upload into the job-photos bucket (item photos go to
-- <userId>/..., proof photos go to proof/<jobId>/...).
drop policy if exists "Authenticated can upload job photos" on storage.objects;
create policy "Authenticated can upload job photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'job-photos');

-- Belt-and-braces: make sure reads work even if the bucket's public flag was
-- ever switched off.
drop policy if exists "Anyone can read job photos" on storage.objects;
create policy "Anyone can read job photos" on storage.objects
  for select
  using (bucket_id = 'job-photos');

-- ============================================================================
-- After running: post a job WITH a photo, check the photo shows on the driver
-- dashboard card, accept the job, take the pickup proof photo (should upload
-- and advance the job), and confirm the proof photo appears on the customer's
-- tracking page.
-- NOTE: jobs posted while uploads were broken have no photos saved -- only new
-- jobs will show them.
-- ============================================================================
