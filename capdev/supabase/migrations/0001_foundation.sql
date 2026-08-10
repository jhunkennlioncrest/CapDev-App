-- 0001 · Foundation: extensions, helpers, shared triggers
-- Capability & Development Platform — Minimum Deployable Version
--
-- Approved architecture references:
--   Domain Blueprint §A (identity), INV-03 (audit immutable), INV-30 (tenancy)
--   Technology Decision Record §4.2 (UUID v7, timestamptz UTC)

create extension if not exists pgcrypto;
create extension if not exists citext;

-- UUID v7: time-sortable, so index locality is preserved without a sequence.
-- Postgres 18 provides uuidv7() natively; this is the fallback for 16/17.
create or replace function public.uuid_v7()
returns uuid
language plpgsql
volatile
security definer
-- Supabase installs pgcrypto into `extensions`, not `public`. Pinning both
-- means gen_random_bytes resolves no matter which schema hosts it, including
-- when called from a function that pins search_path to public only.
set search_path = public, extensions, pg_catalog
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  -- version 7: high nibble of byte 6 := 0111
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  -- variant RFC 4122: top two bits of byte 8 := 10
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  return encode(uuid_bytes, 'hex')::uuid;
end;
$$;

comment on function public.uuid_v7() is
  'Time-sortable UUID v7. Replace with native uuidv7() on Postgres 18+.';

-- Shared updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Blanket rejection, used to make records immutable at the database layer so
-- that no client, service key, or direct psql session can bypass it.
create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Record is immutable (%.%). Corrections create a new record.',
    tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;
