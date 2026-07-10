import {
  timestamp,
  pgTable,
  primaryKey,
  text,
  integer,
  doublePrecision,
  boolean,
  type AnyPgColumn,
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
  nickname: text("nickname"),
  // "Dev" | "QA" | "UX" | "BA" | "PO" | "PM" — fixed set of team roles.
  role: text("role"),
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
  // Short reference key auto-derived from the board name (e.g. "DEV"), so
  // cards can be referenced as "DEV-42". Globally unique.
  key: text("key").notNull().unique(),
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
  // Marks the single list whose cards count as complete for sprint tracking.
  isDoneList: boolean("isDoneList").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const sprints = pgTable("sprint", {
  id: id(),
  boardId: text("boardId")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startDate: timestamp("startDate", { mode: "date" }).notNull(),
  endDate: timestamp("endDate", { mode: "date" }).notNull(),
  // "planned" | "active" | "completed" — a board has at most one non-completed sprint at a time.
  status: text("status").notNull().default("planned"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const cards = pgTable("card", {
  id: id(),
  listId: text("listId")
    .notNull()
    .references(() => lists.id, { onDelete: "cascade" }),
  // Sequential per board (not per list) — combined with the board's key to
  // form a human reference like "DEV-42".
  number: integer("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  position: doublePrecision("position").notNull(),
  dueDate: timestamp("dueDate", { mode: "date" }),
  // "task" | "backlog_item" | "epic" — fixed set of card types, similar to Azure DevOps work item types.
  type: text("type").notNull().default("task"),
  // "high" | "medium" | "low" — priority levels.
  priority: text("priority").notNull().default("medium"),
  // Null means unestimated.
  storyPoints: integer("storyPoints"),
  sprintId: text("sprintId").references(() => sprints.id, { onDelete: "set null" }),
  // Jira-style epic grouping — points at another card of type "epic" on the
  // same board. Null means not assigned to an epic.
  epicId: text("epicId").references((): AnyPgColumn => cards.id, { onDelete: "set null" }),
  // Set automatically when the card enters/leaves the board's Done list —
  // drives sprint burndown charts. Null means not currently done.
  completedAt: timestamp("completedAt", { mode: "date" }),
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

export const cardMembers = pgTable(
  "cardMember",
  {
    cardId: text("cardId")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (cardMember) => [primaryKey({ columns: [cardMember.cardId, cardMember.userId] })],
);

export const checklistItems = pgTable("checklistItem", {
  id: id(),
  cardId: text("cardId")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completed: boolean("completed").notNull().default(false),
  position: doublePrecision("position").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const cardLinks = pgTable("cardLink", {
  id: id(),
  // Stored from cardId's perspective: "blocks" means cardId blocks linkedCardId.
  // "relates_to" is symmetric — direction doesn't affect the displayed label.
  cardId: text("cardId")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  linkedCardId: text("linkedCardId")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const comments = pgTable("comment", {
  id: id(),
  cardId: text("cardId")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { mode: "date" }),
});

export const activities = pgTable("activity", {
  id: id(),
  boardId: text("boardId")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Nullable + set-null on delete so the log entry (with its human-readable
  // message) survives even after the card it refers to is deleted.
  cardId: text("cardId").references(() => cards.id, { onDelete: "set null" }),
  message: text("message").notNull(),
  // "global" (board-wide sidebar) | "card" (that card's activity tab only).
  scope: text("scope").notNull().default("card"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});
