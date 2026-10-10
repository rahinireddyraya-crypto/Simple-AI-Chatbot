# AI Chatbot

A simple, responsive chat app that streams helpful AI responses from Gemini.

## Run & Operate

- `pnpm --filter @workspace/ai-chatbot run dev` — run the chatbot web app
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `GEMINI_API_KEY`, `SUPABASE_URL`, `SERVICE_ROLE_KEY`, and `SESSION_SECRET` — stored in Replit Secrets

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: Supabase Postgres (server-side REST API)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ai-chatbot/` — chat interface and streaming client
- `artifacts/api-server/src/routes/gemini.ts` — Gemini streaming endpoint
- `artifacts/api-server/src/routes/chat-history.ts` — per-browser chat history
- `artifacts/api-server/supabase/schema.sql` — Supabase table setup
- `lib/api-spec/openapi.yaml` — source of truth for API contracts

## Architecture decisions

- The AI provider key is read only by the API server from Replit Secrets and is never sent to the browser.
- Chat history is stored in Supabase and scoped to a signed, HTTP-only browser session cookie; sign-in is not required.

## Product

- Start a new chat, choose a suggested prompt, and continue a conversation with streamed Gemini replies.

## User preferences

_None noted._

## Gotchas

- The `/gemini/chat` response is SSE and must be consumed with `fetch` and a readable stream, not the generated React Query hook.
- Run `artifacts/api-server/supabase/schema.sql` once in the Supabase SQL Editor to create the private `chat_sessions` table.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
