begin;

create table if not exists workspace_private.join_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
alter table workspace_private.join_requests enable row level security;
revoke all on workspace_private.join_requests from public, anon, authenticated;

create or replace function public.workspace_join(
  action text, applicant uuid default null, assigned_role text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  caller_email text;
  request_status text;
begin
  if caller is null then
    return jsonb_build_object('status', 401, 'error', 'sign_in_required');
  end if;
  select m.role into caller_role from workspace_private.members m
    where m.user_id = caller for share;

  if action in ('status', 'apply') then
    if caller_role is not null then return jsonb_build_object('state', 'member'); end if;
    select u.email into caller_email from auth.users u
      where u.id = caller and u.email_confirmed_at is not null and u.email <> ''
        and exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'github');
    if caller_email is null then
      return jsonb_build_object('status', 403, 'error', 'confirmed_github_account_required');
    end if;
    if action = 'apply' then
      insert into workspace_private.join_requests (user_id) values (caller)
        on conflict (user_id) do nothing;
    end if;
    select r.status into request_status from workspace_private.join_requests r where r.user_id = caller;
    if request_status = 'approved' then request_status := 'revoked'; end if;
    return jsonb_build_object('state', coalesce(request_status, 'new'), 'email', caller_email);
  end if;

  if caller_role is distinct from 'owner' then
    return jsonb_build_object('status', 403, 'error', 'owner_required');
  end if;
  if action = 'list' then
    return jsonb_build_object('requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',r.user_id,'email',u.email,'requestedAt',r.requested_at
      ) order by r.requested_at), '[]')
      from workspace_private.join_requests r join auth.users u on u.id = r.user_id
      where r.status = 'pending' and not exists (
        select 1 from workspace_private.members m where m.user_id = r.user_id
      )
    ));
  end if;
  if action is null or action not in ('approve', 'reject') or applicant is null or applicant = caller then
    return jsonb_build_object('status', 400, 'error', 'invalid_decision');
  end if;
  if action = 'approve' and (assigned_role is null or
      assigned_role not in ('manager','submitter','reviewer','viewer')) then
    return jsonb_build_object('status', 400, 'error', 'invalid_role');
  end if;
  select r.status into request_status from workspace_private.join_requests r
    where r.user_id = applicant for update;
  if request_status is distinct from 'pending' or exists (
    select 1 from workspace_private.members m where m.user_id = applicant
  ) then
    return jsonb_build_object('status', 409, 'error', 'already_reviewed');
  end if;
  if action = 'approve' then
    insert into workspace_private.members (user_id, role) values (applicant, assigned_role)
      on conflict (user_id) do nothing;
    if not found then return jsonb_build_object('status', 409, 'error', 'already_reviewed'); end if;
  end if;
  update workspace_private.join_requests r set status = case when action = 'approve' then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = caller where r.user_id = applicant;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.workspace_join(text,uuid,text) from public, anon, authenticated;
grant execute on function public.workspace_join(text,uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;

