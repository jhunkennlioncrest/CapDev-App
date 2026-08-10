-- 0006 · Fix: resolve pgcrypto regardless of which schema hosts it.
--
-- Supabase installs pgcrypto into `extensions`, not `public`. uuid_v7() had no
-- pinned search_path, so when called from write_audit() — which pins
-- `search_path = public` for safety — gen_random_bytes fell out of scope.
--
-- Pinning both schemas here fixes it in either layout.

create or replace function public.uuid_v7()
returns uuid
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);
  return encode(uuid_bytes, 'hex')::uuid;
end;
$$;
