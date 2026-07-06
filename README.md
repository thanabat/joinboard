# Joinboard

A Trello-style kanban board app: boards → lists → cards.

**Stack**: Next.js (App Router, TypeScript) · [Neon](https://neon.tech) (serverless Postgres) · Drizzle ORM · Auth.js (NextAuth v5)

## Setup

1. Create a Neon project at [console.neon.tech](https://console.neon.tech) and copy its pooled connection string.
2. Copy `.env.example` to `.env.local` and fill in:
   - `DATABASE_URL` — the Neon connection string
   - `AUTH_SECRET` — generate with `npx auth secret`
   - `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` — optional, enables GitHub sign-in
3. Install dependencies and push the schema to Neon:
   ```bash
   npm install
   npm run db:generate   # generate SQL migration from src/db/schema.ts
   npm run db:migrate    # apply it to the Neon database
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000), sign up, and create a board.

## Database

- Schema: [`src/db/schema.ts`](src/db/schema.ts)
- Client: [`src/db/index.ts`](src/db/index.ts) — Drizzle over the Neon HTTP driver
- Config: [`drizzle.config.ts`](drizzle.config.ts)
- `npm run db:studio` opens Drizzle Studio to browse data in the Neon database.

## Auth

Configured in [`src/auth.ts`](src/auth.ts): email/password (Credentials provider, JWT sessions) plus optional GitHub OAuth. `src/proxy.ts` protects all `/boards/*` routes.

## Scope of this scaffold

Boards, lists, and cards can all be created through the UI (`src/app/boards/[id]/actions.ts`). Intentionally left out: drag-and-drop reordering, shared-board membership (`boardMember` table exists but isn't wired into the UI yet), and labels.
