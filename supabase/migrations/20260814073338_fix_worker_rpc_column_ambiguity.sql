-- These RPCs expose table-shaped results, so their OUT fields share names with
-- columns used while claiming work. Recompile only the affected functions with
-- a function-local column-precedence rule. This preserves every explicit
-- parameter reference while making queue predicates and updates unambiguous.

begin;

do $migration$
declare
  v_function regprocedure;
  v_definition text;
begin
  foreach v_function in array array[
    'app_private.consume_oauth_state(text,public.integration_provider)'::regprocedure,
    'public.claim_approved_tool_action(uuid)'::regprocedure,
    'public.claim_queued_inbound_agent_run(uuid)'::regprocedure,
    'public.claim_queued_notification(uuid)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_function) into v_definition;

    if position(E'AS $function$\ndeclare' in v_definition) = 0 then
      raise exception 'Expected function definition was not found for %.', v_function;
    end if;

    v_definition := replace(
      v_definition,
      E'AS $function$\ndeclare',
      E'AS $function$\n#variable_conflict use_column\ndeclare'
    );

    execute v_definition;
  end loop;
end;
$migration$;

commit;
