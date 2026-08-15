-- Telegram has no authenticated Supabase session. Bind every inbound private
-- chat to a one-time token issued to an authenticated workspace member, then
-- require both Telegram's sender ID and chat ID for every later message.

begin;

create table private.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table private.telegram_link_tokens enable row level security;

create index telegram_link_tokens_pending_member_idx
  on private.telegram_link_tokens (organization_id, user_id, expires_at desc)
  where used_at is null;

alter table public.conversation_sessions
  add column if not exists telegram_user_id bigint;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.conversation_sessions'::regclass
      and conname = 'conversation_sessions_telegram_user_id_positive'
  ) then
    alter table public.conversation_sessions
      add constraint conversation_sessions_telegram_user_id_positive
      check (telegram_user_id is null or telegram_user_id > 0);
  end if;
end;
$migration$;

-- A private Telegram chat can be assigned to exactly one active tenant/user
-- pair. The partial index is also the lookup path used by the webhook.
create unique index conversation_sessions_active_telegram_identity_idx
  on public.conversation_sessions (telegram_user_id, external_conversation_id)
  where channel = 'telegram'
    and status = 'active'
    and telegram_user_id is not null;

-- These match the authenticated-user RLS predicates and service-side tenant
-- lookups without indexing unrelated archived rows.
create index conversation_sessions_user_id_active_idx
  on public.conversation_sessions (user_id, last_message_at desc)
  where user_id is not null and status = 'active';

create index agent_runs_requested_by_idx
  on public.agent_runs (requested_by, created_at desc)
  where requested_by is not null;

create index tool_actions_requested_by_idx
  on public.tool_actions (requested_by, created_at desc)
  where requested_by is not null;

create index approval_requests_requested_by_idx
  on public.approval_requests (requested_by, created_at desc)
  where requested_by is not null;

create index approval_requests_requested_for_idx
  on public.approval_requests (requested_for, created_at desc)
  where requested_for is not null;

create index notifications_recipient_user_id_idx
  on public.notifications (recipient_user_id, created_at desc)
  where recipient_user_id is not null;

create index notification_deliveries_organization_id_idx
  on public.notification_deliveries (organization_id, created_at desc);

create index webhook_events_organization_id_idx
  on public.webhook_events (organization_id, received_at desc)
  where organization_id is not null;

-- The existing helper is normally called under an authenticated user JWT. A
-- trusted server worker has a service-role JWT instead, so it may evaluate
-- only the explicitly supplied tenant's entitlement. Every caller below has
-- already constrained that tenant before reaching this helper.
create or replace function app_private.has_feature(
  p_organization_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, app_private, auth
as $$
  select
    case
      when coalesce(auth.role(), '') <> 'service_role'
        and not app_private.can_access_organization(p_organization_id)
      then false
      else coalesce(
        (
          select ce.enabled
          from public.customer_entitlements ce
          where ce.organization_id = p_organization_id
            and ce.feature_key = p_feature_key
            and (ce.expires_at is null or ce.expires_at > now())
          limit 1
        ),
        (
          select pe.enabled
          from public.billing_accounts ba
          join public.plan_entitlements pe on pe.plan_id = ba.plan_id
          where ba.organization_id = p_organization_id
            and pe.feature_key = p_feature_key
            and ba.status in ('trial', 'active', 'past_due')
          limit 1
        ),
        false
      )
    end;
$$;

create or replace function app_private.create_telegram_link_token(
  p_organization_id uuid
)
returns table (
  token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_actor_id uuid := auth.uid();
  v_token text;
  v_expires_at timestamptz := now() + interval '10 minutes';
begin
  if v_actor_id is null
    or p_organization_id is null
    or not exists (
      select 1
      from public.memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = v_actor_id
        and membership.is_active
    ) then
    raise exception 'You cannot link Telegram for this organization.'
      using errcode = '42501';
  end if;

  if not app_private.has_feature(p_organization_id, 'telegram') then
    raise exception 'Telegram is not enabled for this organization.'
      using errcode = '42501';
  end if;

  delete from private.telegram_link_tokens link_token
  where link_token.organization_id = p_organization_id
    and link_token.user_id = v_actor_id
    and link_token.used_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into private.telegram_link_tokens (
    token_hash,
    organization_id,
    user_id,
    expires_at
  )
  values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_organization_id,
    v_actor_id,
    v_expires_at
  );

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    action,
    tool_name,
    target_type,
    result
  )
  values (
    p_organization_id,
    'user',
    v_actor_id,
    'telegram.link.requested',
    'telegram',
    'telegram_link_token',
    'requested'
  );

  return query select v_token, v_expires_at;
end;
$function$;

revoke all on function app_private.create_telegram_link_token(uuid)
  from public, anon;
grant execute on function app_private.create_telegram_link_token(uuid)
  to authenticated;

create or replace function public.create_telegram_link_token(
  p_organization_id uuid
)
returns table (
  token text,
  expires_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.create_telegram_link_token($1);
$$;

revoke all on function public.create_telegram_link_token(uuid)
  from public, anon;
grant execute on function public.create_telegram_link_token(uuid)
  to authenticated;

create or replace function app_private.consume_telegram_link_token(
  p_token text,
  p_telegram_user_id bigint,
  p_external_conversation_id text,
  p_external_event_id text,
  p_payload_hash text
)
returns table (
  is_new boolean,
  linked boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_webhook_event_id uuid;
  v_link private.telegram_link_tokens%rowtype;
  v_integration_id uuid;
  v_session public.conversation_sessions%rowtype;
begin
  if p_telegram_user_id is null
    or p_telegram_user_id <= 0
    or nullif(btrim(coalesce(p_external_conversation_id, '')), '') is null
    or char_length(p_external_conversation_id) > 512
    or nullif(btrim(coalesce(p_external_event_id, '')), '') is null
    or char_length(p_external_event_id) > 1024
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  insert into public.webhook_events (
    organization_id,
    integration_id,
    provider,
    external_event_id,
    payload_hash,
    status,
    metadata
  )
  values (
    null,
    null,
    'telegram',
    p_external_event_id,
    p_payload_hash,
    'processing',
    jsonb_build_object('reason', 'telegram_link_requested')
  )
  on conflict (provider, external_event_id) do nothing
  returning id into v_webhook_event_id;

  if v_webhook_event_id is null then
    return query select false, false;
    return;
  end if;

  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    update public.webhook_events
       set status = 'ignored',
           processed_at = now(),
           metadata = jsonb_build_object('reason', 'telegram_link_token_invalid')
     where id = v_webhook_event_id;
    return query select true, false;
    return;
  end if;

  select *
    into v_link
    from private.telegram_link_tokens link_token
   where link_token.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and link_token.used_at is null
     and link_token.expires_at > now()
   for update;

  if not found
    or not exists (
      select 1
      from public.memberships membership
      where membership.organization_id = v_link.organization_id
        and membership.user_id = v_link.user_id
        and membership.is_active
    )
    or not app_private.has_feature(v_link.organization_id, 'telegram') then
    update public.webhook_events
       set status = 'ignored',
           processed_at = now(),
           metadata = jsonb_build_object('reason', 'telegram_link_token_invalid')
     where id = v_webhook_event_id;
    return query select true, false;
    return;
  end if;

  if exists (
    select 1
    from public.conversation_sessions session
    where session.channel = 'telegram'
      and session.status = 'active'
      and session.telegram_user_id = p_telegram_user_id
      and session.external_conversation_id = p_external_conversation_id
      and session.organization_id <> v_link.organization_id
  ) then
    update public.webhook_events
       set status = 'ignored',
           processed_at = now(),
           metadata = jsonb_build_object('reason', 'telegram_identity_already_linked')
     where id = v_webhook_event_id;
    return query select true, false;
    return;
  end if;

  insert into public.integrations (
    organization_id,
    provider,
    external_account_id,
    display_name,
    status,
    connected_by,
    connected_at,
    last_successful_sync_at,
    metadata
  )
  values (
    v_link.organization_id,
    'telegram',
    p_telegram_user_id::text,
    'Telegram',
    'connected',
    v_link.user_id,
    now(),
    now(),
    jsonb_build_object('channel', 'telegram')
  )
  on conflict (organization_id, provider, external_account_id) do update
    set status = 'connected',
        connected_by = excluded.connected_by,
        connected_at = excluded.connected_at,
        revoked_at = null,
        last_error_code = null,
        last_error_at = null,
        updated_at = now()
  returning id into v_integration_id;

  select *
    into v_session
    from public.conversation_sessions session
   where session.organization_id = v_link.organization_id
     and session.channel = 'telegram'
     and session.external_conversation_id = p_external_conversation_id
   for update;

  if found then
    if v_session.status <> 'active'
      or v_session.user_id is distinct from v_link.user_id
      or v_session.telegram_user_id is distinct from p_telegram_user_id then
      update public.webhook_events
         set status = 'ignored',
             processed_at = now(),
             metadata = jsonb_build_object('reason', 'telegram_session_identity_conflict')
       where id = v_webhook_event_id;
      return query select true, false;
      return;
    end if;

    update public.conversation_sessions
       set integration_id = v_integration_id,
           updated_at = now()
     where id = v_session.id
     returning * into v_session;
  else
    begin
      insert into public.conversation_sessions (
        organization_id,
        user_id,
        integration_id,
        channel,
        telegram_user_id,
        external_conversation_id,
        title,
        status
      )
      values (
        v_link.organization_id,
        v_link.user_id,
        v_integration_id,
        'telegram',
        p_telegram_user_id,
        p_external_conversation_id,
        'Telegram chat',
        'active'
      )
      returning * into v_session;
    exception
      when unique_violation then
        update public.webhook_events
           set status = 'ignored',
               processed_at = now(),
               metadata = jsonb_build_object('reason', 'telegram_identity_already_linked')
         where id = v_webhook_event_id;
        return query select true, false;
        return;
    end;
  end if;

  update private.telegram_link_tokens
     set used_at = now()
   where id = v_link.id;

  update public.webhook_events
     set organization_id = v_link.organization_id,
         integration_id = v_integration_id,
         status = 'processed',
         processed_at = now(),
         metadata = jsonb_build_object('reason', 'telegram_identity_linked')
   where id = v_webhook_event_id;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    actor_reference,
    action,
    tool_name,
    target_type,
    target_id,
    result
  )
  values (
    v_link.organization_id,
    'integration',
    v_link.user_id,
    'telegram',
    'telegram.identity.linked',
    'telegram',
    'conversation_session',
    v_session.id::text,
    'succeeded'
  );

  return query select true, true;
end;
$function$;

revoke all on function app_private.consume_telegram_link_token(
  text, bigint, text, text, text
) from public, anon, authenticated;
grant execute on function app_private.consume_telegram_link_token(
  text, bigint, text, text, text
) to service_role;

create or replace function public.consume_telegram_link_token(
  p_token text,
  p_telegram_user_id bigint,
  p_external_conversation_id text,
  p_external_event_id text,
  p_payload_hash text
)
returns table (
  is_new boolean,
  linked boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.consume_telegram_link_token($1, $2, $3, $4, $5);
$$;

revoke all on function public.consume_telegram_link_token(
  text, bigint, text, text, text
) from public, anon, authenticated;
grant execute on function public.consume_telegram_link_token(
  text, bigint, text, text, text
) to service_role;

-- Replace the former public service-role RPC with a private implementation and
-- a public invoker shim. The additional identifiers make Telegram processing
-- fail closed unless the linked session, active membership, and integration
-- all agree on the exact user and tenant.
alter function public.process_inbound_message(
  public.integration_provider, text, text, uuid, uuid,
  public.conversation_channel, text, text, text, timestamptz, text
) set schema app_private;

drop function app_private.process_inbound_message(
  public.integration_provider, text, text, uuid, uuid,
  public.conversation_channel, text, text, text, timestamptz, text
);

create function app_private.process_inbound_message(
  p_provider public.integration_provider,
  p_external_event_id text,
  p_payload_hash text,
  p_organization_id uuid,
  p_integration_id uuid,
  p_channel public.conversation_channel,
  p_external_conversation_id text,
  p_external_message_id text,
  p_body text default null,
  p_sent_at timestamptz default null,
  p_title text default null,
  p_user_id uuid default null,
  p_telegram_user_id bigint default null
)
returns table (
  is_new boolean,
  conversation_session_id uuid,
  queued_agent_run_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_integration public.integrations%rowtype;
  v_webhook_event_id uuid;
  v_session_id uuid;
  v_message_id uuid;
  v_agent_run_id uuid := null;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_sent_at timestamptz := coalesce(p_sent_at, now());
begin
  if p_provider is null
    or p_channel is null
    or p_provider not in ('whatsapp', 'telegram')
    or p_channel::text <> p_provider::text then
    raise exception 'Inbound provider or channel is invalid.' using errcode = '22023';
  end if;

  if p_organization_id is null
    or p_integration_id is null
    or nullif(btrim(coalesce(p_external_event_id, '')), '') is null
    or char_length(p_external_event_id) > 1024
    or nullif(btrim(coalesce(p_external_conversation_id, '')), '') is null
    or char_length(p_external_conversation_id) > 512
    or nullif(btrim(coalesce(p_external_message_id, '')), '') is null
    or char_length(p_external_message_id) > 1024
    or p_payload_hash is null
    or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Inbound message reference is invalid.' using errcode = '22023';
  end if;

  if v_body is not null and char_length(v_body) > 8000
    or v_title is not null and char_length(v_title) > 500 then
    raise exception 'Inbound message content is invalid.' using errcode = '22023';
  end if;

  select *
    into v_integration
    from public.integrations integration
   where integration.id = p_integration_id
     and integration.organization_id = p_organization_id
     and integration.provider = p_provider
     and integration.status = 'connected';

  if not found then
    raise exception 'Inbound integration is not connected to this organization.'
      using errcode = '42501';
  end if;

  if p_provider = 'telegram' then
    if p_user_id is null
      or p_telegram_user_id is null
      or p_telegram_user_id <= 0
      or v_integration.external_account_id is distinct from p_telegram_user_id::text
      or v_integration.connected_by is distinct from p_user_id then
      raise exception 'Telegram identity is not linked to this organization.'
        using errcode = '42501';
    end if;

    select session.id
      into v_session_id
      from public.conversation_sessions session
      join public.memberships membership
        on membership.organization_id = session.organization_id
       and membership.user_id = session.user_id
       and membership.is_active
     where session.organization_id = p_organization_id
       and session.integration_id = p_integration_id
       and session.channel = 'telegram'
       and session.status = 'active'
       and session.user_id = p_user_id
       and session.telegram_user_id = p_telegram_user_id
       and session.external_conversation_id = p_external_conversation_id
     for update of session, membership;

    if v_session_id is null then
      raise exception 'Telegram conversation is not linked to this user.'
        using errcode = '42501';
    end if;
  end if;

  if not app_private.has_feature(p_organization_id, p_provider::text) then
    insert into public.webhook_events (
      organization_id,
      integration_id,
      provider,
      external_event_id,
      payload_hash,
      status,
      metadata
    )
    values (
      p_organization_id,
      p_integration_id,
      p_provider,
      p_external_event_id,
      p_payload_hash,
      'ignored',
      jsonb_build_object('reason', 'feature_not_enabled', 'channel', p_channel::text)
    )
    on conflict (provider, external_event_id) do nothing;

    return query select false, null::uuid, null::uuid;
    return;
  end if;

  insert into public.webhook_events (
    organization_id,
    integration_id,
    provider,
    external_event_id,
    payload_hash,
    status,
    metadata
  )
  values (
    p_organization_id,
    p_integration_id,
    p_provider,
    p_external_event_id,
    p_payload_hash,
    'received',
    jsonb_build_object('reason', 'tenant_resolved', 'channel', p_channel::text)
  )
  on conflict (provider, external_event_id) do nothing
  returning id into v_webhook_event_id;

  if v_webhook_event_id is null then
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  if p_provider = 'telegram' then
    update public.conversation_sessions
       set title = coalesce(title, v_title),
           last_message_at = case
             when last_message_at is null or v_sent_at > last_message_at
             then v_sent_at
             else last_message_at
           end,
           updated_at = now()
     where id = v_session_id
       and organization_id = p_organization_id;
  else
    insert into public.conversation_sessions (
      organization_id,
      integration_id,
      channel,
      external_conversation_id,
      title,
      status,
      last_message_at
    )
    values (
      p_organization_id,
      p_integration_id,
      p_channel,
      p_external_conversation_id,
      v_title,
      'active',
      v_sent_at
    )
    on conflict (organization_id, channel, external_conversation_id)
    do update set
      integration_id = coalesce(excluded.integration_id, public.conversation_sessions.integration_id),
      title = coalesce(public.conversation_sessions.title, excluded.title),
      last_message_at = case
        when public.conversation_sessions.last_message_at is null
          or excluded.last_message_at > public.conversation_sessions.last_message_at
        then excluded.last_message_at
        else public.conversation_sessions.last_message_at
      end,
      updated_at = now()
    returning id into v_session_id;
  end if;

  insert into public.conversation_messages (
    organization_id,
    session_id,
    external_message_id,
    direction,
    sender_type,
    body,
    sent_at
  )
  values (
    p_organization_id,
    v_session_id,
    p_external_message_id,
    'inbound',
    'user',
    v_body,
    v_sent_at
  )
  on conflict (session_id, external_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is not null and v_body is not null then
    insert into public.agent_runs (
      organization_id,
      session_id,
      requested_by,
      provider,
      status,
      input_summary
    )
    values (
      p_organization_id,
      v_session_id,
      p_user_id,
      'inbound_queue',
      'queued',
      'Verified inbound ' || p_provider::text || ' message queued for controlled assistant processing.'
    )
    returning id into v_agent_run_id;
  end if;

  update public.webhook_events
     set status = 'processed',
         processed_at = now(),
         metadata = jsonb_build_object(
           'reason', 'tenant_resolved',
           'channel', p_channel::text,
           'queued_agent_run', v_agent_run_id is not null
         )
   where id = v_webhook_event_id;

  insert into public.audit_logs (
    organization_id,
    actor_type,
    actor_user_id,
    actor_reference,
    action,
    tool_name,
    target_type,
    target_id,
    result,
    metadata
  )
  values (
    p_organization_id,
    'integration',
    p_user_id,
    p_provider::text,
    'conversation.inbound.processed',
    p_provider::text,
    'conversation_session',
    v_session_id::text,
    'succeeded',
    jsonb_build_object(
      'channel', p_channel::text,
      'has_text', v_body is not null,
      'queued_agent_run', v_agent_run_id is not null
    )
  );

  return query select true, v_session_id, v_agent_run_id;
end;
$function$;

revoke all on function app_private.process_inbound_message(
  public.integration_provider, text, text, uuid, uuid,
  public.conversation_channel, text, text, text, timestamptz, text, uuid, bigint
) from public, anon, authenticated;
grant execute on function app_private.process_inbound_message(
  public.integration_provider, text, text, uuid, uuid,
  public.conversation_channel, text, text, text, timestamptz, text, uuid, bigint
) to service_role;

create function public.process_inbound_message(
  p_provider public.integration_provider,
  p_external_event_id text,
  p_payload_hash text,
  p_organization_id uuid,
  p_integration_id uuid,
  p_channel public.conversation_channel,
  p_external_conversation_id text,
  p_external_message_id text,
  p_body text default null,
  p_sent_at timestamptz default null,
  p_title text default null,
  p_user_id uuid default null,
  p_telegram_user_id bigint default null
)
returns table (
  is_new boolean,
  conversation_session_id uuid,
  queued_agent_run_id uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.process_inbound_message(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
  );
$$;

revoke all on function public.process_inbound_message(
  public.integration_provider, text, text, uuid, uuid,
  public.conversation_channel, text, text, text, timestamptz, text, uuid, bigint
) from public, anon, authenticated;
grant execute on function public.process_inbound_message(
  public.integration_provider, text, text, uuid, uuid,
  public.conversation_channel, text, text, text, timestamptz, text, uuid, bigint
) to service_role;

commit;
