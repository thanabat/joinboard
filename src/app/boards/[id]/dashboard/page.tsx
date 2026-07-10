import { auth } from "@/auth";
import { db } from "@/db";
import { boardMembers, boards, cardMembers, cards, checklistItems, lists, sprints, users } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Bookmark, Hash, ListChecks, Milestone, Rocket, SquareCheck, TrendingDown, Users as UsersIcon } from "lucide-react";
import { displayName } from "@/lib/displayName";
import { BoardTabs } from "../BoardTabs";

const CARD_TYPES = {
  epic: { label: "Epic", icon: Milestone, color: "#9333ea" },
  backlog_item: { label: "Product Backlog Item", icon: Bookmark, color: "#d97706" },
  task: { label: "Task", icon: SquareCheck, color: "#4f46e5" },
} as const;

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const boardLists = await db.query.lists.findMany({
    where: eq(lists.boardId, id),
    orderBy: (list, { asc }) => asc(list.position),
  });

  const listIds = boardLists.map((list) => list.id);
  const boardCards = listIds.length
    ? await db.query.cards.findMany({ where: inArray(cards.listId, listIds) })
    : [];

  const cardIds = boardCards.map((card) => card.id);
  const cardMemberRows = cardIds.length
    ? await db.query.cardMembers.findMany({ where: inArray(cardMembers.cardId, cardIds) })
    : [];
  const checklistItemRows = cardIds.length
    ? await db.query.checklistItems.findMany({ where: inArray(checklistItems.cardId, cardIds) })
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

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const totalCards = boardCards.length;
  const overdueCount = boardCards.filter((card) => card.dueDate && card.dueDate < now).length;
  const dueSoonCount = boardCards.filter(
    (card) => card.dueDate && card.dueDate >= now && card.dueDate <= in7Days,
  ).length;
  const noDueDateCount = boardCards.filter((card) => !card.dueDate).length;

  const assignedCardIds = new Set(cardMemberRows.map((row) => row.cardId));
  const unassignedCount = boardCards.filter((card) => !assignedCardIds.has(card.id)).length;

  const cardsPerList = boardLists.map((list) => ({
    id: list.id,
    title: list.title,
    count: boardCards.filter((card) => card.listId === list.id).length,
  }));

  const cardsByType = (Object.keys(CARD_TYPES) as (keyof typeof CARD_TYPES)[]).map((type) => ({
    type,
    ...CARD_TYPES[type],
    count: boardCards.filter((card) => card.type === type).length,
  }));

  const totalChecklistItems = checklistItemRows.length;
  const completedChecklistItems = checklistItemRows.filter((item) => item.completed).length;

  const workload = assignableMembers
    .map((member) => {
      const memberCardIds = new Set(
        cardMemberRows.filter((row) => row.userId === member.userId).map((row) => row.cardId),
      );
      const memberCards = boardCards.filter((card) => memberCardIds.has(card.id));
      return {
        ...member,
        total: memberCards.length,
        points: memberCards.reduce((sum, card) => sum + (card.storyPoints ?? 0), 0),
        overdue: memberCards.filter((card) => card.dueDate && card.dueDate < now).length,
      };
    })
    .sort((a, b) => b.total - a.total);

  const maxListCount = Math.max(1, ...cardsPerList.map((list) => list.count));
  const maxWorkload = Math.max(1, ...workload.map((member) => member.total));

  const doneList = boardLists.find((list) => list.isDoneList);
  const boardSprints = await db.query.sprints.findMany({
    where: eq(sprints.boardId, id),
    orderBy: (sprint, { desc }) => desc(sprint.createdAt),
  });
  // Multiple planned sprints can coexist (planned ahead on the Backlog page),
  // but at most one is ever active — that's the one worth showing progress
  // and a burndown for here; otherwise fall back to the soonest planned one.
  const currentSprint =
    boardSprints.find((sprint) => sprint.status === "active") ??
    boardSprints
      .filter((sprint) => sprint.status === "planned")
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  const pastSprints = boardSprints.filter((sprint) => sprint.status === "completed");

  const sprintProgress = (sprint: (typeof boardSprints)[number]) => {
    const sprintCards = boardCards.filter((card) => card.sprintId === sprint.id);
    const doneCards = doneList ? sprintCards.filter((card) => card.listId === doneList.id) : [];
    return { total: sprintCards.length, done: doneCards.length };
  };

  const sprintPointsProgress = (sprint: (typeof boardSprints)[number]) => {
    const sprintCards = boardCards.filter((card) => card.sprintId === sprint.id);
    const totalPoints = sprintCards.reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
    const donePoints = sprintCards
      .filter((card) => doneList && card.listId === doneList.id)
      .reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
    return { totalPoints, donePoints };
  };

  const daysRemaining = currentSprint
    ? Math.ceil((currentSprint.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  // Burndown: remaining story points per day of the sprint, plotted against
  // the ideal straight-line pace from the sprint's total points down to 0.
  const msPerDay = 24 * 60 * 60 * 1000;
  const burndown =
    currentSprint && currentSprint.status === "active"
      ? (() => {
          const sprintCards = boardCards.filter((card) => card.sprintId === currentSprint.id);
          const totalPoints = sprintCards.reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
          const totalDays = Math.max(
            1,
            Math.round((currentSprint.endDate.getTime() - currentSprint.startDate.getTime()) / msPerDay),
          );
          const points = Array.from({ length: totalDays + 1 }, (_, day) => {
            const date = new Date(currentSprint.startDate.getTime() + day * msPerDay);
            const ideal = totalPoints * (1 - day / totalDays);
            if (date.getTime() > now.getTime()) return { day, date, ideal, actual: null };
            const completedPoints = sprintCards
              .filter((card) => card.completedAt && card.completedAt.getTime() <= date.getTime())
              .reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
            return { day, date, ideal, actual: totalPoints - completedPoints };
          });
          return { totalPoints, totalDays, points };
        })()
      : null;

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link
              href="/boards"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              ← Boards
            </Link>
            <span className="text-border">/</span>
            <h1 className="text-lg font-semibold tracking-tight">{board.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <BoardTabs boardId={board.id} active="dashboard" />
            <Link
              href="/profile"
              className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Profile
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <Rocket className="h-3.5 w-3.5" />
            Sprint
          </h2>

          {!doneList && (
            <p className="rounded-md bg-accent-tint px-3 py-2 text-sm text-accent">
              Mark a list as &quot;Done&quot; on the board to track sprint completion automatically.
            </p>
          )}

          {currentSprint ? (
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{currentSprint.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {currentSprint.startDate.toLocaleDateString("en-US")} –{" "}
                    {currentSprint.endDate.toLocaleDateString("en-US")}
                    {currentSprint.status === "active" &&
                      daysRemaining !== null &&
                      ` · ${daysRemaining >= 0 ? `${daysRemaining} days left` : "overdue"}`}
                  </p>
                </div>
                <span
                  className={
                    currentSprint.status === "active"
                      ? "shrink-0 rounded bg-accent-tint px-2 py-1 text-xs font-medium text-accent"
                      : "shrink-0 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
                  }
                >
                  {currentSprint.status === "active" ? "Active" : "Planned — start it on the Sprints page"}
                </span>
              </div>
              {(() => {
                const { total, done } = sprintProgress(currentSprint);
                const { totalPoints, donePoints } = sprintPointsProgress(currentSprint);
                return (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1.5">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {done}/{total} cards done
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
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Hash className="h-3 w-3" />
                          {donePoints}/{totalPoints} points done
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <Link
              href={`/boards/${id}/backlog`}
              className="flex items-center gap-1.5 rounded-lg border border-dashed bg-card px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Rocket className="h-3.5 w-3.5" />
              No sprint yet — plan one on the Sprints page
            </Link>
          )}

          {pastSprints.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Past sprints</span>
              <ul className="flex flex-col gap-1">
                {pastSprints.map((sprint) => {
                  const { total, done } = sprintProgress(sprint);
                  return (
                    <li
                      key={sprint.id}
                      className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{sprint.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {sprint.startDate.toLocaleDateString("en-US")} – {sprint.endDate.toLocaleDateString("en-US")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {done}/{total} done
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {burndown && (
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5" />
              Burndown
            </h2>
            <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              {burndown.totalPoints === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No estimated cards in this sprint yet — add story points to see a burndown.
                </p>
              ) : (
                (() => {
                  const width = 640;
                  const height = 240;
                  const padding = { top: 12, right: 12, bottom: 28, left: 32 };
                  const plotWidth = width - padding.left - padding.right;
                  const plotHeight = height - padding.top - padding.bottom;
                  const x = (day: number) => padding.left + (day / burndown.totalDays) * plotWidth;
                  const y = (value: number) =>
                    padding.top + (1 - value / burndown.totalPoints) * plotHeight;

                  const idealPath = burndown.points
                    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.day)},${y(point.ideal)}`)
                    .join(" ");
                  const actualPoints = burndown.points.filter(
                    (point): point is typeof point & { actual: number } => point.actual !== null,
                  );
                  const actualPath = actualPoints
                    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.day)},${y(point.actual)}`)
                    .join(" ");

                  return (
                    <>
                      <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
                        {[0, 0.5, 1].map((fraction) => (
                          <line
                            key={fraction}
                            x1={padding.left}
                            x2={width - padding.right}
                            y1={y(burndown.totalPoints * fraction)}
                            y2={y(burndown.totalPoints * fraction)}
                            className="stroke-border"
                            strokeWidth={1}
                          />
                        ))}
                        {[0, 0.5, 1].map((fraction) => (
                          <text
                            key={fraction}
                            x={padding.left - 6}
                            y={y(burndown.totalPoints * fraction)}
                            textAnchor="end"
                            dominantBaseline="middle"
                            className="fill-muted-foreground text-[10px]"
                          >
                            {Math.round(burndown.totalPoints * fraction)}
                          </text>
                        ))}
                        <path d={idealPath} fill="none" className="stroke-muted-foreground" strokeDasharray="4 3" strokeWidth={1.5} />
                        <path d={actualPath} fill="none" className="stroke-primary" strokeWidth={2} />
                        {actualPoints.map((point) => (
                          <circle key={point.day} cx={x(point.day)} cy={y(point.actual)} r={2.5} className="fill-primary" />
                        ))}
                        <text x={padding.left} y={height - 8} textAnchor="start" className="fill-muted-foreground text-[10px]">
                          {burndown.points[0].date.toLocaleDateString("en-US")}
                        </text>
                        <text
                          x={width - padding.right}
                          y={height - 8}
                          textAnchor="end"
                          className="fill-muted-foreground text-[10px]"
                        >
                          {burndown.points[burndown.points.length - 1].date.toLocaleDateString("en-US")}
                        </text>
                      </svg>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="h-0.5 w-4 shrink-0 border-t-2 border-dashed border-muted-foreground" />
                          Ideal
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-0.5 w-4 shrink-0 bg-primary" />
                          Actual
                        </span>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Task summary</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border bg-card p-4">
              <span className="text-2xl font-semibold tracking-tight">{totalCards}</span>
              <p className="text-xs text-muted-foreground">Total cards</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <span className="text-2xl font-semibold tracking-tight text-destructive">{overdueCount}</span>
              <p className="text-xs text-muted-foreground">Overdue</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <span className="text-2xl font-semibold tracking-tight text-accent">{dueSoonCount}</span>
              <p className="text-xs text-muted-foreground">Due within 7 days</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <span className="text-2xl font-semibold tracking-tight">{noDueDateCount}</span>
              <p className="text-xs text-muted-foreground">No due date</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <span className="text-2xl font-semibold tracking-tight">{unassignedCount}</span>
              <p className="text-xs text-muted-foreground">Unassigned</p>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Cards per list</h2>
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            {cardsPerList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lists yet.</p>
            ) : (
              cardsPerList.map((list) => (
                <div key={list.id} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm">{list.title}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(list.count / maxListCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-sm text-muted-foreground">{list.count}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Cards by type</h2>
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
              {cardsByType.map(({ type, label, icon: TypeIcon, color, count }) => (
                <div key={type} className="flex items-center gap-2 text-sm">
                  <TypeIcon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                  <span className="flex-1">{label}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <ListChecks className="h-3.5 w-3.5" />
              Checklist progress
            </h2>
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
              {totalChecklistItems === 0 ? (
                <p className="text-sm text-muted-foreground">No checklist items yet.</p>
              ) : (
                <>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(completedChecklistItems / totalChecklistItems) * 100}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {completedChecklistItems}/{totalChecklistItems} items complete
                  </p>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <UsersIcon className="h-3.5 w-3.5" />
            Workload
          </h2>
          <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            {workload.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
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
                  {member.overdue > 0 && (
                    <span className="shrink-0 text-xs font-medium text-destructive">
                      {member.overdue} overdue
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
