-- A verified inbound message is persisted, mapped to a tenant conversation,
-- and queued for the agent in one transaction. The webhook handler receives
-- only the boolean result, so provider retries cannot create a second message
-- or agent run after the event id has been committed.

begin;

create or replace function public.process_inbound_message(
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
  p_title text default null
)
returns table (
  is_new boolean,
  conversation_session_id uuid,
  queued_agent_run_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
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

  if p_integration_id is not null then
    select *
      into v_integration
      from public.integrations
     where id = p_integration_id
       and organization_id = p_organization_id
       and provider = p_provider
       and status = 'connected';

    if not found then
      raise exception 'Inbound integration is not connected to this organization.'
        using errcode = '42501';
    end if;
  elsif p_provider = 'whatsapp' or not exists (
    select 1
    from public.conversation_sessions
    where organization_id = p_organization_id
      and channel = p_channel
      and external_conversation_id = p_external_conversation_id
  ) then
    -- WhatsApp tenant resolution must always come from a connected sender.
    -- Telegram may omit an integration only for an already linked chat.
    raise exception 'Inbound conversation is not linked to this organization.'
      using errcode = '42501';
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
      provider,
      status,
      input_summary
    )
    values (
      p_organization_id,
      v_session_id,
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
$$;

revoke all on function public.process_inbound_message(
  public.integration_provider, text, text, uuid, uuid,
  public.conversation_channel, text, text, text, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.process_inbound_message(
  public.integration_provider, text, text, uuid, uuid,
  public.conversation_channel, text, text, text, timestamptz, text
) to service_role;

commit;
