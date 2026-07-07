import {
  timestamp,
  pgTable,
  primaryKey,
  text,
  integer,
  doublePrecision,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

// --- Auth.js tables (shape required by @auth/drizzle-adapter) ---

export const users = pgTable("user", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("passwordHash"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ],
);

// --- Kanban domain tables ---

export const boards = pgTable("board", {
  id: id(),
  name: text("name").notNull(),
  ownerId: text("ownerId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  // Shareable join link token — null means no active invite link for this board.
  inviteToken: text("inviteToken").unique(),
});

export const boardMembers = pgTable(
  "boardMember",
  {
    boardId: text("boardId")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    // "invited" (pending) | "active" (accepted) | "blocked" (denied access, can't be re-invited until unblocked)
    status: text("status").notNull().default("invited"),
  },
  (boardMember) => [
    primaryKey({ columns: [boardMember.boardId, boardMember.userId] }),
  ],
);

export const lists = pgTable("list", {
  id: id(),
  boardId: text("boardId")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  position: doublePrecision("position").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const cards = pgTable("card", {
  id: id(),
  listId: text("listId")
    .notNull()
    .references(() => lists.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  position: doublePrecision("position").notNull(),
  dueDate: timestamp("dueDate", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const labels = pgTable("label", {
  id: id(),
  boardId: text("boardId")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
});

export const cardLabels = pgTable(
  "cardLabel",
  {
    cardId: text("cardId")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    labelId: text("labelId")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (cardLabel) => [primaryKey({ columns: [cardLabel.cardId, cardLabel.labelId] })],
);
