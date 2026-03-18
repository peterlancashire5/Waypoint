-- supabase/migrations/010_document_storage.sql
-- Document storage pipeline: stores original booking/accommodation source files
-- in Supabase Storage and links them to their parsed records.

-- ─── document_files ────────────────────────────────────────────────────────────

create table public.document_files (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users not null,
  trip_id           uuid references public.trips on delete cascade,  -- nullable for inbox documents
  storage_path      text not null,
  file_type         text not null check (file_type in ('pdf', 'jpg', 'png')),
  original_filename text not null,
  file_size_bytes   integer,
  created_at        timestamptz default now() not null
);

alter table public.document_files enable row level security;

-- Users can read documents for trips they are members of, or their own inbox docs
create policy "document_files: members can read"
  on public.document_files for select
  using (
    (trip_id is null and user_id = auth.uid())
    or is_trip_member(trip_id)
  );

-- Users can insert their own documents
create policy "document_files: authenticated can insert"
  on public.document_files for insert
  with check (user_id = auth.uid());

-- Users can delete their own documents
create policy "document_files: owner can delete"
  on public.document_files for delete
  using (user_id = auth.uid());

-- ─── document_links ────────────────────────────────────────────────────────────

create table public.document_links (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid references public.document_files on delete cascade not null,
  linkable_type  text not null check (linkable_type in ('leg_booking', 'accommodation', 'saved_place')),
  linkable_id    uuid not null,
  created_at     timestamptz default now() not null,
  unique (document_id, linkable_type, linkable_id)
);

alter table public.document_links enable row level security;

-- Inherit access from parent document_files via EXISTS subquery
create policy "document_links: members can read"
  on public.document_links for select
  using (
    exists (
      select 1 from public.document_files df
      where df.id = document_links.document_id
        and (
          (df.trip_id is null and df.user_id = auth.uid())
          or is_trip_member(df.trip_id)
        )
    )
  );

create policy "document_links: authenticated can insert"
  on public.document_links for insert
  with check (
    exists (
      select 1 from public.document_files df
      where df.id = document_links.document_id
        and df.user_id = auth.uid()
    )
  );

create policy "document_links: owner can delete"
  on public.document_links for delete
  using (
    exists (
      select 1 from public.document_files df
      where df.id = document_links.document_id
        and df.user_id = auth.uid()
    )
  );

-- ─── Storage bucket (apply separately via SQL Editor) ─────────────────────────
-- insert into storage.buckets (id, name, public) values ('documents', 'documents', false);
--
-- Storage object policies (applied via apply_migration):
--   "storage: users can upload own docs" — insert where folder = user_id
--   "storage: members can read docs"     — select via user_id prefix or is_trip_member
--   "storage: users can delete own docs" — delete where folder = user_id
