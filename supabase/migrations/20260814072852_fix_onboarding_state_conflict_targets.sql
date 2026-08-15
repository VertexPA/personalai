-- `organization_id` is also a RETURNS TABLE output field. The function's
-- conflict targets must resolve that identifier as a table column, not as the
-- output variable. Re-create the immediately preceding definition with the
-- documented function-local PL/pgSQL conflict policy. The guarded replacement
-- makes the migration fail loudly if the predecessor's function shape changes.

begin;

do $migration$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'app_private.save_onboarding_state(uuid,text,text,text,text,text,jsonb,jsonb,jsonb,text,text,boolean,time without time zone,integer,integer,boolean,text,text,boolean)'::regprocedure
  )
  into v_definition;

  if position(E'AS $function$\ndeclare' in v_definition) = 0 then
    raise exception 'Expected onboarding function definition was not found.';
  end if;

  v_definition := replace(
    v_definition,
    E'AS $function$\ndeclare',
    E'AS $function$\n#variable_conflict use_column\ndeclare'
  );

  execute v_definition;
end;
$migration$;

commit;
