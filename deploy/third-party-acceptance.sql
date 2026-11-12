create or replace function workspace_private.review_records_unchanged(old_doc jsonb, new_doc jsonb)
returns boolean language sql set search_path = '' as $$
  select not exists (
    select 1 from jsonb_array_elements(new_doc->'tasks') as proposed
    left join jsonb_array_elements(old_doc->'tasks') as previous on previous->'id' = proposed->'id'
    where (
      nullif(proposed->'officialReview', 'null'::jsonb)
        is distinct from nullif(previous->'officialReview', 'null'::jsonb)
      and not (
        previous is null and proposed->'officialReview' is not null
        and exists (
          select 1 from workspace_private.revisions r
          where r.document->'tasks' @> jsonb_build_array(jsonb_build_object(
            'id', proposed->'id', 'officialReview', proposed->'officialReview',
            'projectId', proposed->'projectId', 'owner', proposed->'owner',
            'deliverable', proposed->'deliverable', 'acceptanceStatus', proposed->'acceptanceStatus'
          ))
        )
      )
    ) or (
      nullif(proposed->'internalReview', 'null'::jsonb)
        is distinct from nullif(previous->'internalReview', 'null'::jsonb)
      and not (
        previous is null and proposed->'internalReview' is not null
        and exists (
          select 1 from workspace_private.revisions r
          where r.document->'tasks' @> jsonb_build_array(jsonb_build_object(
            'id', proposed->'id', 'projectId', proposed->'projectId',
            'internalReview', proposed->'internalReview'
          ))
        )
      )
    ) or (
      nullif(proposed->'acceptanceSubmission', 'null'::jsonb)
        is distinct from nullif(previous->'acceptanceSubmission', 'null'::jsonb)
      and not (
        previous is null and proposed->'acceptanceSubmission' is not null
        and exists (
          select 1 from workspace_private.revisions r
          where r.document->'tasks' @> jsonb_build_array(jsonb_build_object(
            'id', proposed->'id', 'projectId', proposed->'projectId',
            'acceptanceSubmission', proposed->'acceptanceSubmission'
          ))
        )
      )
    ) or (
      previous->'acceptanceSubmission' is not null
      and previous->>'acceptanceStatus' = 'pending' and exists (
        select 1 from unnest(array['owner','projectId','status','deliverable','acceptanceStatus',
          'requiresAcceptance','acceptanceCriteria','acceptanceGap','submittedBy']) as field
        where previous->field is distinct from proposed->field
      )
    ) or (
      previous is not null and coalesce(previous->>'acceptanceStatus','not_ready') <> 'accepted'
      and proposed->>'acceptanceStatus' = 'accepted'
    ) or (
      previous->'officialReview'->>'verdict' = 'accepted' and exists (
        select 1 from unnest(array['owner','projectId','status','deliverable','acceptanceStatus','requiresAcceptance']) as field
        where previous->field is distinct from proposed->field
      )
    )
  )
$$;
revoke all on function workspace_private.review_records_unchanged(jsonb,jsonb) from public, anon, authenticated;

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
      or (member_role = 'reviewer' and (task->>'acceptanceStatus' = 'pending'
        or task->'officialReview'->>'reviewer' = email)));
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
  organization text;
  conclusion text;
  evidence text;
  verdict text;
  material_summary text;
  material_links jsonb;
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
      if not workspace_private.review_records_unchanged(old_doc, doc) or
          (member_role = 'manager' and not workspace_private.manager_can_save(old_doc,doc)) then
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
        elsif action = 'submit'
          and coalesce(task->>'requiresAcceptance', case when coalesce(task->>'acceptanceCriteria','') <> ''
            or coalesce(task->>'acceptanceGap','') <> '' or acceptance = 'returned' then 'true' else 'false' end) = 'true' then
          material_links := coalesce(payload->'links', '[]'::jsonb);
          if payload ? 'summary' then
            material_summary := btrim(payload->>'summary', E' \t\r\n');
            if jsonb_typeof(payload->'summary') is distinct from 'string'
              or char_length(material_summary) not between 1 and 4000 then
              return jsonb_build_object('status',400,'error','materials_required');
            end if;
          else
            -- Retain compatibility with already open tabs that submit an existing deliverable.
            material_summary := btrim(coalesce(task->>'deliverable',''), E' \t\r\n');
            if task->>'status' is distinct from 'done' or material_summary = '' then
              return jsonb_build_object('status',400,'error','materials_required');
            end if;
          end if;
          if jsonb_typeof(material_links) <> 'array' then
            return jsonb_build_object('status',400,'error','invalid_material_links');
          end if;
          if jsonb_array_length(material_links) > 10 or exists (
            select 1 from jsonb_array_elements(material_links) as link
            where jsonb_typeof(link) <> 'string' or char_length(link#>>'{}') > 500
              or link#>>'{}' !~* '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
              or position(chr(92) in link#>>'{}') > 0
          ) then return jsonb_build_object('status',400,'error','invalid_material_links'); end if;
          if member_role = 'owner' then
            if (payload ? 'criteria' and (jsonb_typeof(payload->'criteria') is distinct from 'string'
                or char_length(payload->>'criteria') > 4000))
              or (payload ? 'gap' and (jsonb_typeof(payload->'gap') is distinct from 'string'
                or char_length(payload->>'gap') > 2000)) then
              return jsonb_build_object('status',400,'error','invalid_acceptance_criteria');
            end if;
            task := task || jsonb_build_object(
              'acceptanceCriteria', coalesce(payload->>'criteria', task->>'acceptanceCriteria',''),
              'acceptanceGap', coalesce(payload->>'gap', task->>'acceptanceGap',''));
          end if;
          task := (task - 'internalReview') || jsonb_build_object('status','done','requiresAcceptance',true,
            'acceptanceStatus','pending','submittedBy',email,'reviewedBy','',
            'acceptanceSubmission',jsonb_build_object('summary',material_summary,'links',material_links,
              'submittedBy',email,'submittedAt',now()));
        else return jsonb_build_object('status',403,'error','forbidden');
        end if;
      elsif member_role = 'owner' and ((action = 'internal-approve' and acceptance in ('pending','accepted'))
          or (action = 'internal-return' and acceptance = 'pending')) then
        conclusion := coalesce(btrim(payload->>'reason'), '');
        if (payload ? 'reason' and jsonb_typeof(payload->'reason') is distinct from 'string')
          or char_length(conclusion) > 2000
          or (action = 'internal-return' and conclusion = '') then
          return jsonb_build_object('status',400,'error','internal_review_details_required');
        end if;
        verdict := case when action = 'internal-approve' then 'accepted' else 'returned' end;
        task := task || jsonb_build_object('internalReview', jsonb_build_object(
          'verdict',verdict,'conclusion',conclusion,'reviewer',email,'reviewedAt',now()));
        if action = 'internal-return' then
          task := task || jsonb_build_object('acceptanceStatus','returned','acceptanceReturnReason',conclusion);
        end if;
      elsif acceptance = 'pending' and member_role = 'reviewer' and not assigned
        and lower(coalesce(task->>'submittedBy','')) <> email and action in ('approve','return') then
        organization := btrim(payload->>'organization');
        conclusion := btrim(payload->>'conclusion');
        evidence := btrim(payload->>'evidence');
        if jsonb_typeof(payload->'organization') is distinct from 'string'
          or jsonb_typeof(payload->'conclusion') is distinct from 'string'
          or jsonb_typeof(payload->'evidence') is distinct from 'string'
          or char_length(organization) not between 1 and 160
          or char_length(conclusion) not between 1 and 2000
          or char_length(evidence) not between 1 and 500
          or (action = 'return' and (jsonb_typeof(payload->'reason') is distinct from 'string'
              or btrim(payload->>'reason') = '')) then
          return jsonb_build_object('status',400,'error','review_details_required');
        end if;
        verdict := case when action = 'approve' then 'accepted' else 'returned' end;
        task := task || jsonb_build_object('acceptanceStatus',verdict,'reviewedBy',email,
          'officialReview',jsonb_build_object('organization',organization,'conclusion',conclusion,
            'evidence',evidence,'verdict',verdict,'reviewer',email,'reviewedAt',now()));
        if action = 'return' then
          task := task || jsonb_build_object('acceptanceReturnReason',btrim(payload->>'reason'));
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
  return jsonb_build_object('role',member_role,'actor',email,'acceptanceMode','third_party','acceptanceFlow','materials',
    'state',workspace_private.scoped_document(doc,email,member_role) || jsonb_build_object('revision',current_revision));
end;
$$;
revoke all on function public.workspace_api(text,jsonb) from public, anon, authenticated;
grant execute on function public.workspace_api(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
