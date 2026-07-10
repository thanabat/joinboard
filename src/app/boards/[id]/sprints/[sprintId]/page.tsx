import { auth } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards, cardMembers, cards, lists, sprintRetroItems, sprints, users } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Hash, Users as UsersIcon } from "lucide-react";
import { displayName } from "@/lib/displayName";
import { RetroBoard } from "./RetroBoard";
import { BurndownChart } from "./BurndownChart";

export default async function SprintDetailPage({
  params,
}: {
  params: Promise<{ id: string; sprintId: string }>;
}) {
  const { id, sprintId } = await params;
  const session = await auth();
  const userId = session!.user!.id;

  const board = await db.query.boards.findFirst({ where: eq(boards.id, id) });
  if (!board) notFound();

  const isAdmin = board.ownerId === userId;
  if (!isAdmin) {
    const membership = await db.query.boardMembers.findFirst({
      where: and(
        eq(boardMembers.boardId, id),
        eq(boardMembers.userId, userId),
        eq(boardMembers.status, "active"),
      ),
    });
    if (!membership) notFound();
  }

  const sprint = await db.query.sprints.findFirst({ where: eq(sprints.id, sprintId) });
  if (!sprint || sprint.boardId !== id) notFound();

  const boardLists = await db.query.lists.findMany({ where: eq(lists.boardId, id) });
  const doneList = boardLists.find((list) => list.isDoneList);

  const sprintCards = await db.query.cards.findMany({ where: eq(cards.sprintId, sprintId) });
  const totalCards = sprintCards.length;
  const doneCards = doneList ? sprintCards.filter((card) => card.listId === doneList.id) : [];
  const totalPoints = sprintCards.reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
  const donePoints = doneCards.reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);

  const sprintCardIds = sprintCards.map((card) => card.id);
  const cardMemberRows = sprintCardIds.length
    ? await db.query.cardMembers.findMany({ where: inArray(cardMembers.cardId, sprintCardIds) })
    : [];
  const owner = await db.query.users.findFirst({ where: eq(users.id, board.ownerId) });
  const memberRows = await db.query.boardMembers.findMany({ where: eq(boardMembers.boardId, id) });
  const memberUserIds = memberRows.map((row) => row.userId);
  const memberUsers = memberUserIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, memberUserIds) })
    : [];
  const assignableMembers = [
    { userId: board.ownerId, displayName: owner ? displayName(owner) : "(unknown)" },
    ...memberRows
      .filter((row) => row.status === "active")
      .map((row) => {
        const user = memberUsers.find((candidate) => candidate.id === row.userId);
        return { userId: row.userId, displayName: user ? displayName(user) : "(unknown)" };
      }),
  ];
  const workload = assignableMembers
    .map((member) => {
      const memberCardIds = new Set(
        cardMemberRows.filter((row) => row.userId === member.userId).map((row) => row.cardId),
      );
      const memberCards = sprintCards.filter((card) => memberCardIds.has(card.id));
      return {
        ...member,
        total: memberCards.length,
        points: memberCards.reduce((sum, card) => sum + (card.storyPoints ?? 0), 0),
      };
    })
    .filter((member) => member.total > 0)
    .sort((a, b) => b.total - a.total);
  const maxWorkload = Math.max(1, ...workload.map((member) => member.total));

  const retroItemRows =
    sprint.status === "completed"
      ? await db.query.sprintRetroItems.findMany({
          where: eq(sprintRetroItems.sprintId, sprintId),
          orderBy: (item, { asc }) => asc(item.position),
        })
      : [];
  const retroAuthorIds = [...new Set(retroItemRows.map((item) => item.authorId))];
  const retroAuthors = retroAuthorIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, retroAuthorIds) })
    : [];
  const retroItems = retroItemRows.map((item) => {
    const author = retroAuthors.find((candidate) => candidate.id === item.authorId);
    return {
      id: item.id,
      column: item.column as "went_well" | "to_improve" | "action_items",
      content: item.content,
      authorName: author ? displayName(author) : "(unknown)",
    };
  });

  const now = new Date();
  const daysRemaining =
    sprint.status === "active" ? Math.ceil((sprint.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link
              href={`/boards/${id}/backlog`}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              ← Sprints
            </Link>
            <span className="text-border">/</span>
            <h1 className="text-lg font-semibold tracking-tight">{sprint.name}</h1>
          </div>
          <Link
            href="/profile"
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Profile
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4">
            <div>
              <p className="text-xs text-muted-foreground">
                {sprint.startDate.toLocaleDateString("en-US")} – {sprint.endDate.toLocaleDateString("en-US")}
                {sprint.status === "active" &&
                  daysRemaining !== null &&
                  ` · ${daysRemaining >= 0 ? `${daysRemaining} days left` : "overdue"}`}
              </p>
            </div>
            <span
              className={
                sprint.status === "active"
                  ? "shrink-0 rounded bg-accent-tint px-2 py-1 text-xs font-medium text-accent"
                  : sprint.status === "completed"
                    ? "shrink-0 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
                    : "shrink-0 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
              }
            >
              {sprint.status === "active" ? "Active" : sprint.status === "completed" ? "Completed" : "Planned"}
            </span>
          </div>

          {!doneList && (
            <p className="rounded-md bg-accent-tint px-3 py-2 text-sm text-accent">
              Mark a list as &quot;Done&quot; on the board to track sprint completion automatically.
            </p>
          )}

          <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            <div className="flex flex-col gap-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${totalCards === 0 ? 0 : (doneCards.length / totalCards) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {doneCards.length}/{totalCards} cards done
              </p>
            </div>
            {totalPoints > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(donePoints / totalPoints) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {donePoints}/{totalPoints} points done
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <UsersIcon className="h-3.5 w-3.5" />
            Workload
          </h2>
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            {workload.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cards assigned in this sprint yet.</p>
            ) : (
              workload.map((member) => (
                <div key={member.userId} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm">{member.displayName}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(member.total / maxWorkload) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-sm text-muted-foreground">{member.total}</span>
                  {member.points > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground">
                      <Hash className="h-3 w-3" />
                      {member.points}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {sprint.status !== "planned" && (
          <BurndownChart
            startDate={sprint.startDate}
            endDate={sprint.endDate}
            cards={sprintCards.map((card) => ({ storyPoints: card.storyPoints, completedAt: card.completedAt }))}
          />
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Retrospective</h2>
          {sprint.status === "completed" ? (
            <RetroBoard sprintId={sprint.id} initialItems={retroItems} />
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Retrospective notes unlock once this sprint is completed.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
