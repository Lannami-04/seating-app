-- =====================================================================
-- 8 · Undo a "Checked" mark
--
-- check_table (file 5) marks a table as compared with the real floor. If it was pressed on the wrong
-- table, uncheck_table removes the mark again, writes "Unchecked P4" to Recent changes, and bumps the
-- event so every tablet takes the mark away too.
-- Paste into the Supabase SQL Editor after the earlier files.
-- =====================================================================

create or replace function public.uncheck_table(p_event uuid, p_table text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_layout uuid := private.lock_live_event(p_event);
begin
  delete from public.table_checks k where k.event_id = p_event and k.table_id = p_table;
  if found then
    perform private.log_change(p_event, format('Unchecked %s', private.table_label(v_layout, p_table)), array[p_table]);
    perform private.bump_event(p_event);
  end if;
end;
$$;

revoke all on function public.uncheck_table(uuid, text) from public, anon;
grant execute on function public.uncheck_table(uuid, text) to authenticated;
