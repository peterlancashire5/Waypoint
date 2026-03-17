-- Add accommodation type and provider-specific fields

alter table public.accommodation
  add column if not exists accommodation_type   text not null default 'hotel',
  add column if not exists host_name            text,
  add column if not exists access_code         text,
  add column if not exists checkin_instructions text,
  add column if not exists room_type            text,
  add column if not exists checkin_hours        text;
