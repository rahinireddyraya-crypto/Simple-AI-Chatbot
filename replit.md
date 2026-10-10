# AI Chatbot

A simple, responsive chat app that streams helpful AI responses from Gemini.

## Run & Operate

- `pnpm --filter @workspace/ai-chatbot run dev` — run the chatbot web app
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `GEMINI_API_KEY` — Gemini API key stored in Replit Secrets

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ai-chatbot/` — chat interface and streaming client
- `artifacts/api-server/src/routes/gemini.ts` — Gemini streaming endpoint
- `lib/api-spec/openapi.yaml` — source of truth for API contracts

## Architecture decisions

- The AI provider key is read only by the API server from Replit Secrets and is never sent to the browser.
- Chat history stays in the current browser session; no database persistence or sign-in is required.

## Product

- Start a new chat, choose a suggested prompt, and continue a conversation with streamed Gemini replies.

## User preferences

_None noted._

## Gotchas

- The `/gemini/chat` response is SSE and must be consumed with `fetch` and a readable stream, not the generated React Query hook.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
