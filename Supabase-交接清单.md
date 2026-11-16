# Supabase 交接清单

给后续接手的人（或另一个 AI）：数据库部分**尚未做任何改动**，下面写清楚已经确认了什么、还差什么、以及怎么补。

## 一句话现状

代码、Git 仓库、线上网页三方已对齐（`main` = `09ad51e`，Pages 构建成功）。
Supabase 保持原样，没有执行也没有修改任何 SQL。

## 1. 已经确认的事实（匿名即可验证）

| 检查 | 结果 |
| --- | --- |
| 项目 ref | `snmwombeyxlryxcxhxtq` |
| 认证服务 | `GET /auth/v1/health` → `{"version":"v2.197.0","name":"GoTrue"}` |
| `public.workspace_api` | 存在。匿名调用返回 `42501 permission denied for function workspace_api` |
| `public.workspace_join` | 存在。匿名调用返回 `42501 permission denied for function workspace_join` |
| 权限约束 | 两个函数都只授给 `authenticated`，匿名拿不到执行权，符合预期 |

函数存在与否可以直接区分：若未部署，PostgREST 会返回 `Could not find the function ... in schema cache`；实际返回的是权限错误，说明**函数已部署**。

由此可以判断：`deploy/workspace.sql` 和 `deploy/github-join.sql` 都已经执行过。

## 2. 待确认的事项（需要数据库权限）

1. `deploy/third-party-acceptance.sql` 是否执行过。
   唯一判据：`workspace_private.review_records_unchanged(jsonb, jsonb)` 是否存在。该函数只在这个升级脚本里创建。
2. `public.workspace_api` 的函数体是基础版还是升级版。
   基础版在 `deploy/workspace.sql` 第 146–259 行，升级版在 `deploy/third-party-acceptance.sql` 第 148–349 行。两者的路由名相同，只能靠函数体差异区分。
3. `workspace_private.join_requests` 是否已启用行级安全（`github-join.sql` 里有 `enable row level security`）。
4. 云端成员角色分布、是否已有正式数据、`workspace_private.state` 的 revision 与项目数。

## 3. 判据 SQL（可直接粘进 Supabase SQL Editor）

```sql
-- 是否已执行第三方验收升级
select exists (
  select 1
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'workspace_private' and p.proname = 'review_records_unchanged'
) as has_third_party_upgrade;
```

```sql
-- 已部署的函数与函数体长度
select n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       length(p.prosrc) as body_length
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'workspace_private')
order by 1, 2;
```

```sql
-- 表与行级安全状态
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'workspace_private'
order by 1;
```

```sql
-- 成员角色与云端数据规模
select role, count(*) from workspace_private.members group by role order by 1;
select revision, jsonb_array_length(document->'projects') as projects,
       jsonb_array_length(document->'tasks') as tasks
from workspace_private.state;
```

判断标准：`has_third_party_upgrade = true` 且 `workspace_api` 的 `body_length` 与升级版接近，说明数据库已是最新；否则需要执行升级脚本。

## 4. 如果确实需要升级，按这个顺序

1. **先备份**：Project Settings → Database → Backups 做一次备份，或导出 `workspace_private.state` 的 `document`。
2. 在 SQL Editor 里**整份**执行 `deploy/third-party-acceptance.sql`。
   该文件没有 `begin/commit` 包裹，语句逐条生效；但全部是 `create or replace`，整体重跑是安全的。若中途报错，修好环境后从头再跑一遍即可，不要只挑其中几条执行。
3. 重新跑第 3 节的判据 SQL，确认 `has_third_party_upgrade = true`。
4. 执行一次端到端验收（见第 6 节）。
5. 提醒所有已打开的工作台标签页刷新，避免旧页面提交被 `client_upgrade_required` 拒绝。

## 5. 用 Management API 执行（有访问令牌时）

不需要安装 CLI，直接调用即可：

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/snmwombeyxlryxcxhxtq/database/query" \
  -H "Authorization: Bearer sbp_你的令牌" \
  -H "Content-Type: application/json" \
  -d '{"query":"select 1"}'
```

令牌在 <https://supabase.com/dashboard/account/tokens> 生成，用完记得吊销。它拥有账号级 API 权限，不要写进仓库，也不要交给前端。

## 6. 上线验收清单

- 用所有者、项目管理员、提交者、第三方验收员、只读成员五种身份分别登录，确认权限边界。
- 提交者提交材料 → 所有者内部通过 → 第三方验收员登记机构、结论、凭证 → 提交第三方结果。
- 退回补交：确认生成新版本，旧材料与退回原因仍可查。
- 撤销权限：所有者撤销某账号后，该账号立即失去工作区访问。
- 并发冲突：两个标签页同时提交，后提交的返回 `revision_conflict`，草稿保留。
- 导出 JSON 与云端数据一致；导入恢复流程可用。

## 7. 项目坐标

| 项目 | 值 |
| --- | --- |
| 仓库 | <https://github.com/X-J-Jun/engineering-workspace> |
| 分支 / 当前提交 | `main` / `09ad51e` |
| 线上地址 | <https://x-j-jun.github.io/engineering-workspace/> |
| 发布工作流 | `.github/workflows/pages.yml`（push 到 `main` 自动触发） |
| 数据库脚本 | `deploy/workspace.sql`、`deploy/github-join.sql`、`deploy/third-party-acceptance.sql` |
| 浏览器端适配 | `deploy/cloud.js`（构建时注入） |
| 前端入口 | `index.html`（单文件，含全部样式与页面逻辑） |

## 8. 注意事项

- `sb_publishable_...` 是浏览器端密钥，只能调用 RPC，**不能执行 DDL**。改库必须用 SQL Editor、数据库连接或 Management API。
- 前端重新发布不影响 Supabase 里的项目数据；改数据库逻辑则要单独应用 SQL。
- 修改数据库逻辑前先在测试项目验证，再上正式项目。
- 本地 `workspace.sqlite3` 只是"本机共享服务"模式的数据，与云端完全无关，不要混用。
- 本机网络到 `github.com` 直连不稳定，`codeload`、Pages、`api.github.com` 正常；推送依赖 Windows 凭据管理器里已存的 GitHub 账号。

## 9. 本机环境备忘

- 工作目录已经是 git 仓库，`main` 跟踪 `origin/main`，工作树干净。
- 仓库配置 `core.autocrlf=false`，工作树与仓库字节一致。
- `_site/` 是本地构建产物：Windows 下生成 CRLF，CI 在 Linux 上生成 LF，内容一致，不影响发布。
- `workspace.sqlite3`、JSON 备份、`_site/`、`__pycache__/` 都被 `.gitignore` 排除。
