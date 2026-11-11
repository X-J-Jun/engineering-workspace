begin;
create schema if not exists workspace_private;
revoke all on schema workspace_private from public, anon, authenticated;

create table if not exists workspace_private.members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','manager','submitter','reviewer','viewer'))
);
create unique index if not exists workspace_single_owner
  on workspace_private.members (role) where role = 'owner';

create table if not exists workspace_private.state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0,
  document jsonb not null default '{"version":2,"projects":[],"tasks":[],"risks":[]}'
);
insert into workspace_private.state default values on conflict do nothing;

create table if not exists workspace_private.revisions (
  revision bigint primary key,
  actor uuid not null,
  saved_at timestamptz not null default now(),
  document jsonb not null
);
revoke all on all tables in schema workspace_private from public, anon, authenticated;

create or replace function workspace_private.valid_document(doc jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare
  collection text;
begin
  if doc is null or jsonb_typeof(doc) <> 'object' or doc->'version' is distinct from '2'::jsonb then
    return false;
  end if;
  foreach collection in array array['projects','tasks','risks'] loop
    if jsonb_typeof(doc->collection) is distinct from 'array' then return false; end if;
    if exists (
      select 1 from jsonb_array_elements(doc->collection) as item
      where jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') is distinct from 'string'
        or item->>'id' = ''
    ) or exists (
      select 1 from jsonb_array_elements(doc->collection) as item group by item->>'id' having count(*) > 1
    ) then return false; end if;
  end loop;
  return not exists (
    select 1 from jsonb_array_elements((doc->'tasks') || (doc->'risks')) as item
    where not exists (select 1 from jsonb_array_elements(doc->'projects') as project
                      where project->'id' = item->'projectId')
  ) and not exists (
    select 1 from jsonb_array_elements(doc->'tasks') as task
    where task->>'level' = '2' and not exists (
      select 1 from jsonb_array_elements(doc->'tasks') as parent
      where parent->'id' = task->'parentId' and parent->'projectId' = task->'projectId'
        and parent->>'level' = '1'
    )
  );
end;
$$;

create or replace function workspace_private.scoped_document(doc jsonb, email text, member_role text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  visible jsonb;
begin
  if member_role in ('owner','manager','viewer') then return doc; end if;
  select coalesce(jsonb_agg(task), '[]') into visible
  from jsonb_array_elements(doc->'tasks') as task
  where task->>'level' = '2'
    and ((member_role = 'submitter' and lower(task->>'owner') = email)
      or (member_role = 'reviewer' and task->>'acceptanceStatus' = 'pending'));
  return jsonb_build_object(
    'version',2, 'risks','[]'::jsonb,
    'projects',(select coalesce(jsonb_agg(jsonb_build_object('id',p->'id','name',p->'name')),'[]')
      from jsonb_array_elements(doc->'projects') as p
      where exists (select 1 from jsonb_array_elements(visible) as task where task->'projectId' = p->'id')),
    'tasks',(select coalesce(jsonb_agg(task),'[]')
      from jsonb_array_elements(doc->'tasks') as task
      where exists (select 1 from jsonb_array_elements(visible) as item
                    where task->'id' in (item->'id',item->'parentId')))
  );
end;
$$;

create or replace function workspace_private.manager_can_save(old_doc jsonb, new_doc jsonb)
returns boolean language sql set search_path = '' as $$
  select not exists (
    select 1
    from jsonb_array_elements(old_doc->'tasks') as old
    full join jsonb_array_elements(new_doc->'tasks') as new on old->'id' = new->'id'
    where (
      new is not null and (
        coalesce(old->>'acceptanceStatus','not_ready') <> coalesce(new->>'acceptanceStatus','not_ready')
        or coalesce(old->>'acceptanceReturnReason','') <> coalesce(new->>'acceptanceReturnReason','')
        or coalesce(old->>'submittedBy','') <> coalesce(new->>'submittedBy','')
        or coalesce(old->>'reviewedBy','') <> coalesce(new->>'reviewedBy','')
      )
    ) or (old->>'acceptanceStatus' in ('pending','accepted') and (
      new is null or new->>'requiresAcceptance' = 'false'
      or exists (
        select 1 from unnest(array['owner','projectId','status','deliverable','acceptanceCriteria','acceptanceGap']) as f
        where coalesce(old->>f,'') <> coalesce(new->>f,'')
      )
    ))
  )
$$;

create or replace function public.workspace_api(route text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  member_role text;
  email text;
  target uuid;
  action text := payload->>'action';
  old_doc jsonb;
  doc jsonb;
  task jsonb;
  task_index int;
  current_revision bigint;
  acceptance text;
  assigned boolean;
begin
  -- Hold membership for the duration of a read or write so revocation is ordered with it.
  select m.role, lower(u.email) into member_role,email
  from workspace_private.members m join auth.users u on u.id = m.user_id
  where m.user_id = uid for share of m;
  if member_role is null or email is null then
    return jsonb_build_object('status',403,'error','forbidden');
  end if;
  if route in ('members','member-write') then
    if member_role <> 'owner' then return jsonb_build_object('status',403,'error','forbidden'); end if;
    if route = 'members' then
      return jsonb_build_object('members', (
        select coalesce(jsonb_agg(jsonb_build_object('name',u.email,'role',m.role) order by u.email),'[]')
        from workspace_private.members m join auth.users u on u.id = m.user_id));
    end if;
    select u.id into target from auth.users u where lower(u.email) = lower(btrim(payload->>'name'));
    if target is null then return jsonb_build_object('status',400,'error','account_missing'); end if;
    if target = uid then return jsonb_build_object('status',403,'error','forbidden'); end if;
    if action = 'remove' then
      delete from workspace_private.members where user_id = target and role <> 'owner';
    elsif action = 'save' and payload->>'role' in ('manager','submitter','reviewer','viewer') then
      insert into workspace_private.members(user_id,role) values(target,payload->>'role')
      on conflict(user_id) do update set role = excluded.role where members.role <> 'owner';
    else
      return jsonb_build_object('status',400,'error','invalid_member');
    end if;
    return jsonb_build_object('ok',true);
  end if;

  if route = 'state' then
    select s.revision,s.document into current_revision,doc from workspace_private.state s where singleton;
  elsif route in ('sync','task-action') then
    if (route = 'sync' and member_role not in ('owner','manager')) or
        (payload ? 'actor' and payload->>'actor' is distinct from email) then
      return jsonb_build_object('status',403,'error','forbidden');
    end if;
    select s.revision,s.document into current_revision,old_doc from workspace_private.state s where singleton for update;
    doc := old_doc;
    if route = 'sync' and payload->'state' = old_doc then
      null;
    elsif payload->'revision' is distinct from to_jsonb(current_revision) then
      return jsonb_build_object('status',409,'error','revision_conflict');
    elsif route = 'sync' then
      doc := payload->'state';
      if not workspace_private.valid_document(doc) then
        return jsonb_build_object('status',400,'error','invalid_state');
      end if;
      if member_role = 'manager' and not workspace_private.manager_can_save(old_doc,doc) then
        return jsonb_build_object('status',403,'error','forbidden');
      end if;
    else
      select item,(ordinality - 1)::int into task,task_index
      from jsonb_array_elements(doc->'tasks') with ordinality as t(item,ordinality)
      where item->>'id' = payload->>'taskId' and item->>'level' = '2';
      if task is null then return jsonb_build_object('status',403,'error','forbidden'); end if;
      assigned := lower(coalesce(task->>'owner','')) = email;
      acceptance := coalesce(task->>'acceptanceStatus','not_ready');
      if action in ('update','submit') and acceptance not in ('pending','accepted')
        and (member_role = 'owner' or (member_role = 'submitter' and assigned)) then
        if action = 'update' and payload->>'status' in ('todo','doing','done')
            and jsonb_typeof(payload->'deliverable') = 'string' and btrim(payload->>'deliverable') <> '' then
          task := task || jsonb_build_object('status',payload->>'status','deliverable',btrim(payload->>'deliverable'));
        elsif action = 'submit' and task->>'status' = 'done' and btrim(coalesce(task->>'deliverable','')) <> ''
          and coalesce(task->>'requiresAcceptance', case when coalesce(task->>'acceptanceCriteria','') <> ''
            or coalesce(task->>'acceptanceGap','') <> '' or acceptance = 'returned' then 'true' else 'false' end) = 'true' then
          task := task || jsonb_build_object('acceptanceStatus','pending','submittedBy',email,'reviewedBy','');
        else return jsonb_build_object('status',403,'error','forbidden');
        end if;
      elsif acceptance = 'pending' and (member_role = 'owner' or (
        member_role = 'reviewer' and not assigned and lower(coalesce(task->>'submittedBy','')) <> email
      )) then
        if action = 'approve' then
          task := task || jsonb_build_object('acceptanceStatus','accepted','reviewedBy',email);
        elsif action = 'return' and jsonb_typeof(payload->'reason') = 'string' and btrim(payload->>'reason') <> '' then
          task := task || jsonb_build_object('acceptanceStatus','returned','reviewedBy',email,
            'acceptanceReturnReason',btrim(payload->>'reason'));
        else return jsonb_build_object('status',403,'error','forbidden');
        end if;
      else return jsonb_build_object('status',403,'error','forbidden');
      end if;
      doc := jsonb_set(doc,array['tasks',task_index::text],task);
    end if;
    if doc is distinct from old_doc then
      current_revision := current_revision + 1;
      update workspace_private.state set document = doc, revision = current_revision where singleton;
      insert into workspace_private.revisions values(current_revision,uid,now(),doc);
    end if;
  else
    return jsonb_build_object('status',404,'error','not_found');
  end if;
  return jsonb_build_object('role',member_role,'actor',email,
    'state',workspace_private.scoped_document(doc,email,member_role) || jsonb_build_object('revision',current_revision));
end;
$$;
revoke all on function public.workspace_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.workspace_api(text,jsonb) to authenticated;
commit;

