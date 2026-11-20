-- Private storage buckets and object policies (plan §2.2, §2.7, §6.5).
-- Every bucket is private; clients read through short-lived signed URLs that these policies authorize.
--
-- Path conventions (first folder is the authorization key):
--   verification-docs/{user_id}/{file}
--   avatars/{user_id}/{file}
--   listing-images/{listing_id}/{file}
--   evidence/{booking_id}/{uploader_user_id}/{file}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('verification-docs', 'verification-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']),
  ('avatars',           'avatars',           false, 2097152,  array['image/jpeg', 'image/png', 'image/webp']),
  ('listing-images',    'listing-images',    false, 5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('evidence',          'evidence',          false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- verification-docs: owner uploads into their own folder; owner + staff can read.
-- Deleting is allowed only before the file is attached to a submission (review history is preserved).
create policy "verification docs: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification-docs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "verification docs: owner or staff read" on storage.objects for select to authenticated
  using (bucket_id = 'verification-docs'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or app_private.is_staff()));
create policy "verification docs: owner delete unsubmitted" on storage.objects for delete to authenticated
  using (bucket_id = 'verification-docs'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and not exists (select 1 from public.student_verifications v where v.document_path = name));

-- avatars: members can see avatars; owners manage their own.
create policy "avatars: member read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
create policy "avatars: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- listing-images: visible wherever the listing is visible; managed by the listing's lender.
create policy "listing images: viewer read" on storage.objects for select to authenticated
  using (bucket_id = 'listing-images'
         and exists (select 1 from public.listings l
                      where l.id::text = (storage.foldername(name))[1] and app_private.can_view_listing(l.id)));
create policy "listing images: lender insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-images'
              and exists (select 1 from public.listings l
                           where l.id::text = (storage.foldername(name))[1] and l.lender_id = (select auth.uid())));
create policy "listing images: lender delete" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-images'
         and exists (select 1 from public.listings l
                      where l.id::text = (storage.foldername(name))[1] and l.lender_id = (select auth.uid())));

-- evidence: booking parties upload into their own sub-folder; parties + staff read.
create policy "evidence: party insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence'
              and (storage.foldername(name))[2] = (select auth.uid())::text
              and exists (select 1 from public.bookings b
                           where b.id::text = (storage.foldername(name))[1]
                             and (select auth.uid()) in (b.borrower_id, b.lender_id)));
create policy "evidence: party or staff read" on storage.objects for select to authenticated
  using (bucket_id = 'evidence'
         and (app_private.is_staff()
              or exists (select 1 from public.bookings b
                          where b.id::text = (storage.foldername(name))[1]
                            and (select auth.uid()) in (b.borrower_id, b.lender_id))));
