Here is the plan.

<<<orc-file path="plan/architecture.md">>>
---
tags: [plan]
---
# Architecture

Next.js 15 App Router app on Vercel. Supabase provides Postgres and magic-link auth.
Server actions in `src/server/` read and write todos through the typed client; the UI in `src/app/` calls them.

```
src/
  app/            routes and UI (web)
  components/     UI components (web)
  server/         server actions and data access (api)
  lib/supabase.ts Supabase client factory (api)
contracts/        shared types, copied into src/contracts by api/T1
```
<<<orc-end>>>

<<<orc-file path="plan/agents.md">>>
# agents.md: todo

## Stack
- Next.js 15 (App Router)
- @supabase/supabase-js 2
- Tailwind CSS 4
- Vitest 3

## Commands
- npm run typecheck / npm run lint / npm test / npm run build

## Hard rules
- Never edit files under contracts/.
<<<orc-end>>>

<<<orc-file path="plan/setup.md">>>
# Setup

## Accounts
- [ ] Supabase: create a project, copy the URL and anon key

## Env vars
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL (Settings → API)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key (Settings → API)
- `SENTRY_DSN`: Sentry project DSN (optional)

## Packages
- npm install next@15 react react-dom @supabase/supabase-js
<<<orc-end>>>

<<<orc-file path="plan/docs-needed.md">>>
# Docs needed

## Docs
- `supabase.md`: supabase-js v2 auth (magic link) and queries (https://supabase.com/docs/reference/javascript)
- `nextjs.md`: Next.js 15 server actions and route handlers (https://nextjs.org/docs/app)
<<<orc-end>>>

<<<orc-file path="contracts/types.ts">>>
export interface Todo {
  readonly id: string;
  readonly title: string;
  readonly done: boolean;
  readonly createdAt: string;
}

export type TodoFilter = "all" | "open" | "done";
<<<orc-end>>>

<<<orc-file path="contracts/db-schema.sql">>>
create table todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
<<<orc-end>>>

<<<orc-file path="plan/workstreams/api.md">>>
---
tags: [plan, workstream]
---
# Workstream: api

## Goal
Server actions for todo CRUD on Supabase, typed by contracts/types.ts.

## Owns
- `src/server/**`
- `src/lib/supabase.ts`

## Tasks
- [ ] T1: Add the Supabase client factory and a typed todos repository with tests (needs: web/T1)
- [ ] T2: Implement listTodos, addTodo, toggleTodo and deleteTodo server actions with tests

## Definition of done
- Every action in the contracts is implemented and tested
- typecheck, lint, test and build pass
<<<orc-end>>>

<<<orc-file path="plan/workstreams/web.md">>>
---
tags: [plan, workstream]
---
# Workstream: web

## Goal
The todo UI: sign-in page, list with filters, add form.

## Owns
- `src/app/**`
- `src/components/**`
- `package.json`

## Tasks
- [ ] T1: Scaffold Next.js 15 with Tailwind, Vitest, lint and the four npm scripts
- [ ] T2: Build the magic-link sign-in page
- [ ] T3: Build the todo list with all/open/done filters and an add form (needs: api/T2)

## Definition of done
- A signed-in user can add, tick, filter and delete todos
- typecheck, lint, test and build pass
<<<orc-end>>>
