-- ============================================================
-- Waypoint — Initial Schema
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Tables ──────────────────────────────────────────────────────────────────

-- trips
create table public.trips (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           text not null check (type in ('single', 'multi')),
  start_date     date,
  end_date       date,
  status         text not null default 'upcoming'
                   check (status in ('upcoming', 'active', 'past')),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now()
);

-- trip_members
create table public.trip_members (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  unique (trip_id, user_id)
);

-- stops
create table public.stops (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  city         text not null,
  country      text,
  latitude     float,
  longitude    float,
  start_date   date,
  end_date     date,
  nights       integer,
  order_index  integer,
  created_at   timestamptz not null default now()
);

-- accommodation (private per user)
create table public.accommodation (
  id                uuid primary key default gen_random_uuid(),
  stop_id           uuid not null references public.stops(id) on delete cascade,
  owner_id          uuid not null references auth.users(id) on delete cascade,
  name              text,
  address           text,
  check_in          time,
  check_out         time,
  confirmation_ref  text,
  wifi_name         text,
  wifi_password     text,
  door_code         text,
  created_at        timestamptz not null default now()
);

-- legs
create table public.legs (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  from_stop_id    uuid references public.stops(id),
  to_stop_id      uuid references public.stops(id),
  transport_type  text check (transport_type in ('flight', 'train', 'bus', 'car', 'ferry', 'other')),
  departure_time  timestamptz,
  arrival_time    timestamptz,
  order_index     integer,
  created_at      timestamptz not null default now()
);

-- leg_bookings (private per user)
create table public.leg_bookings (
  id                uuid primary key default gen_random_uuid(),
  leg_id            uuid not null references public.legs(id) on delete cascade,
  owner_id          uuid not null references auth.users(id) on delete cascade,
  operator          text,
  reference         text,
  seat              text,
  confirmation_ref  text,
  created_at        timestamptz not null default now()
);

-- days
create table public.days (
  id          uuid primary key default gen_random_uuid(),
  stop_id     uuid not null references public.stops(id) on delete cascade,
  date        date not null,
  created_at  timestamptz not null default now(),
  unique (stop_id, date)
);

-- events
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  day_id       uuid references public.days(id) on delete cascade,
  stop_id      uuid references public.stops(id),
  title        text not null,
  time         time,
  is_floating  boolean not null default false,
  category     text,
  notes        text,
  created_at   timestamptz not null default now()
);

-- saved_items
create table public.saved_items (
  id          uuid primary key default gen_random_uuid(),
  stop_id     uuid references public.stops(id) on delete cascade,
  trip_id     uuid references public.trips(id),
  creator_id  uuid references auth.users(id),
  name        text not null,
  category    text check (category in (
                'Restaurant',
                'Bar & Nightlife',
                'Café',
                'Museum & Gallery',
                'Temple & Religious Site',
                'Nature & Park',
                'Shopping',
                'Activity & Experience',
                'Accommodation',
                'Transport'
              )),
  photo_url   text,
  note        text,
  is_inbox    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- trip_invites
create table public.trip_invites (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  invited_by       uuid references auth.users(id),
  invited_user_id  uuid references auth.users(id),
  status           text not null default 'pending'
                     check (status in ('pending', 'accepted', 'declined')),
  created_at       timestamptz not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index on public.trips (owner_id);
create index on public.trip_members (trip_id);
create index on public.trip_members (user_id);
create index on public.stops (trip_id);
create index on public.accommodation (stop_id);
create index on public.accommodation (owner_id);
create index on public.legs (trip_id);
create index on public.leg_bookings (leg_id);
create index on public.leg_bookings (owner_id);
create index on public.days (stop_id);
create index on public.events (day_id);
create index on public.events (stop_id);
create index on public.saved_items (stop_id);
create index on public.saved_items (trip_id);
create index on public.saved_items (creator_id);
create index on public.saved_items (is_inbox) where is_inbox = true;
create index on public.trip_invites (trip_id);
create index on public.trip_invites (invited_user_id);

-- ─── Helper function ─────────────────────────────────────────────────────────
-- Returns true if the current user is a member OR owner of the given trip.

create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.trips
    where id = p_trip_id and owner_id = auth.uid()
  )
  or exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = auth.uid()
  );
$$;

-- ─── Enable RLS ───────────────────────────────────────────────────────────────

alter table public.trips          enable row level security;
alter table public.trip_members   enable row level security;
alter table public.stops          enable row level security;
alter table public.accommodation  enable row level security;
alter table public.legs           enable row level security;
alter table public.leg_bookings   enable row level security;
alter table public.days           enable row level security;
alter table public.events         enable row level security;
alter table public.saved_items    enable row level security;
alter table public.trip_invites   enable row level security;

-- ─── RLS Policies ────────────────────────────────────────────────────────────

-- ── trips ────────────────────────────────────────────────────────────────────
-- Owner and members can read
create policy "trips: members can read"
  on public.trips for select
  using (public.is_trip_member(id));

-- Only owner can insert
create policy "trips: owner can insert"
  on public.trips for insert
  with check (owner_id = auth.uid());

-- Only owner can update
create policy "trips: owner can update"
  on public.trips for update
  using (owner_id = auth.uid());

-- Only owner can delete
create policy "trips: owner can delete"
  on public.trips for delete
  using (owner_id = auth.uid());

-- ── trip_members ─────────────────────────────────────────────────────────────
-- Trip owner and the member themselves can read
create policy "trip_members: visible to owner and self"
  on public.trip_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.trips
      where id = trip_id and owner_id = auth.uid()
    )
  );

-- Only the trip owner can add members
create policy "trip_members: owner can insert"
  on public.trip_members for insert
  with check (
    exists (
      select 1 from public.trips
      where id = trip_id and owner_id = auth.uid()
    )
  );

-- Owner can remove members; members can remove themselves
create policy "trip_members: owner or self can delete"
  on public.trip_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.trips
      where id = trip_id and owner_id = auth.uid()
    )
  );

-- ── stops ────────────────────────────────────────────────────────────────────
create policy "stops: trip members can read"
  on public.stops for select
  using (public.is_trip_member(trip_id));

create policy "stops: trip members can insert"
  on public.stops for insert
  with check (public.is_trip_member(trip_id));

create policy "stops: trip members can update"
  on public.stops for update
  using (public.is_trip_member(trip_id));

create policy "stops: trip owner can delete"
  on public.stops for delete
  using (
    exists (
      select 1 from public.trips
      where id = trip_id and owner_id = auth.uid()
    )
  );

-- ── accommodation (private — owner only) ─────────────────────────────────────
create policy "accommodation: owner only"
  on public.accommodation for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ── legs ─────────────────────────────────────────────────────────────────────
create policy "legs: trip members can read"
  on public.legs for select
  using (public.is_trip_member(trip_id));

create policy "legs: trip members can insert"
  on public.legs for insert
  with check (public.is_trip_member(trip_id));

create policy "legs: trip members can update"
  on public.legs for update
  using (public.is_trip_member(trip_id));

create policy "legs: trip owner can delete"
  on public.legs for delete
  using (
    exists (
      select 1 from public.trips
      where id = trip_id and owner_id = auth.uid()
    )
  );

-- ── leg_bookings (private — owner only) ──────────────────────────────────────
create policy "leg_bookings: owner only"
  on public.leg_bookings for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ── days ─────────────────────────────────────────────────────────────────────
create policy "days: trip members can read"
  on public.days for select
  using (
    exists (
      select 1 from public.stops
      where id = stop_id and public.is_trip_member(trip_id)
    )
  );

create policy "days: trip members can insert"
  on public.days for insert
  with check (
    exists (
      select 1 from public.stops
      where id = stop_id and public.is_trip_member(trip_id)
    )
  );

create policy "days: trip members can update"
  on public.days for update
  using (
    exists (
      select 1 from public.stops
      where id = stop_id and public.is_trip_member(trip_id)
    )
  );

create policy "days: trip owner can delete"
  on public.days for delete
  using (
    exists (
      select 1 from public.stops s
      join public.trips t on t.id = s.trip_id
      where s.id = stop_id and t.owner_id = auth.uid()
    )
  );

-- ── events ───────────────────────────────────────────────────────────────────
create policy "events: trip members can read"
  on public.events for select
  using (
    -- floating events joined via stop_id
    (stop_id is not null and exists (
      select 1 from public.stops
      where id = stop_id and public.is_trip_member(trip_id)
    ))
    or
    -- day-attached events joined via day → stop
    (day_id is not null and exists (
      select 1 from public.days d
      join public.stops s on s.id = d.stop_id
      where d.id = day_id and public.is_trip_member(s.trip_id)
    ))
  );

create policy "events: trip members can insert"
  on public.events for insert
  with check (
    (stop_id is not null and exists (
      select 1 from public.stops
      where id = stop_id and public.is_trip_member(trip_id)
    ))
    or
    (day_id is not null and exists (
      select 1 from public.days d
      join public.stops s on s.id = d.stop_id
      where d.id = day_id and public.is_trip_member(s.trip_id)
    ))
  );

create policy "events: trip members can update"
  on public.events for update
  using (
    (stop_id is not null and exists (
      select 1 from public.stops
      where id = stop_id and public.is_trip_member(trip_id)
    ))
    or
    (day_id is not null and exists (
      select 1 from public.days d
      join public.stops s on s.id = d.stop_id
      where d.id = day_id and public.is_trip_member(s.trip_id)
    ))
  );

create policy "events: trip members can delete"
  on public.events for delete
  using (
    (stop_id is not null and exists (
      select 1 from public.stops
      where id = stop_id and public.is_trip_member(trip_id)
    ))
    or
    (day_id is not null and exists (
      select 1 from public.days d
      join public.stops s on s.id = d.stop_id
      where d.id = day_id and public.is_trip_member(s.trip_id)
    ))
  );

-- ── saved_items ───────────────────────────────────────────────────────────────
-- Inbox items (is_inbox = true) are visible only to the creator.
-- Filed items (is_inbox = false) are visible to all trip members.
create policy "saved_items: members can read filed, creator can read inbox"
  on public.saved_items for select
  using (
    (is_inbox = false and trip_id is not null and public.is_trip_member(trip_id))
    or
    (creator_id = auth.uid())
  );

create policy "saved_items: creator can insert"
  on public.saved_items for insert
  with check (creator_id = auth.uid());

create policy "saved_items: creator can update"
  on public.saved_items for update
  using (creator_id = auth.uid());

create policy "saved_items: creator can delete"
  on public.saved_items for delete
  using (creator_id = auth.uid());

-- ── trip_invites ─────────────────────────────────────────────────────────────
create policy "trip_invites: visible to inviter and invited user"
  on public.trip_invites for select
  using (
    invited_by = auth.uid()
    or invited_user_id = auth.uid()
  );

-- Only trip owner can send invites
create policy "trip_invites: owner can insert"
  on public.trip_invites for insert
  with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.trips
      where id = trip_id and owner_id = auth.uid()
    )
  );

-- Invited user can update their own invite (accept/decline)
create policy "trip_invites: invited user can update"
  on public.trip_invites for update
  using (invited_user_id = auth.uid());

-- Owner or invited user can delete
create policy "trip_invites: owner or invited user can delete"
  on public.trip_invites for delete
  using (
    invited_by = auth.uid()
    or invited_user_id = auth.uid()
  );
