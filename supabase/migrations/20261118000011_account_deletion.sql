-- Account deletion vs append-only history (plan §6.5 data deletion; §2.5/§10.1 append-only).
--
-- audit_logs.actor_id and booking_events.actor_id are ON DELETE SET NULL. Deleting an account makes
-- Postgres issue that UPDATE, which the append-only trigger rejected, so no user with history could be
-- deleted. Allow exactly one change: the actor is cleared (pseudonymised) and every other column is
-- unchanged. Any other UPDATE or DELETE is still refused.
-- Ledger rows keep ON DELETE RESTRICT on purpose: financial records are retained, so an account with
-- simulated money history must be anonymised rather than deleted (handled in a later phase).

create or replace function app_private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and tg_table_name in ('audit_logs', 'booking_events')
     and (to_jsonb(old) ->> 'actor_id') is not null
     and (to_jsonb(new) ->> 'actor_id') is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op using errcode = '42501';
end
$$;
