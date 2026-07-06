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

Boards, lists, and cards can be created and deleted, and lists/cards can be drag-and-dropped to reorder (including across lists) via [`src/app/boards/[id]/Board.tsx`](<src/app/boards/[id]/Board.tsx>), backed by `@dnd-kit`. Card/list titles have a quick inline rename; a card's description, due date, and labels are edited in a modal (opened via the "Add details…" line on the card face). Labels are per-board, colored, and created on the fly from the modal.

## Board membership

The board creator is always the admin (`boards.ownerId`, not a `boardMember` row). Admins invite other **registered** users by email from the "Members" button on a board — invites can only be sent to accounts that already exist (there's no email-sending infra to invite someone who hasn't signed up yet). An invited user sees it under "Invitations" on `/boards` and can Accept or Decline. Admins can Kick (remove) or Block (revoke + prevent re-invite until unblocked) any active or invited member from the Members modal; a kicked/removed member loses board access immediately (`src/app/boards/[id]/actions.ts`'s `requireBoardAccess` checks `boardMembers.status = 'active'` OR ownership). Members have the same read/write access to lists/cards/labels as the admin — only membership management is admin-only.

## Deploying (Vercel)

`DATABASE_URL` and `AUTH_SECRET` (and optionally `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET`) must be set in the Vercel project's Environment Variables — `.env.local` is gitignored and never reaches the deployed build.
