"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Calendar,
  ChevronDown,
  ChevronRight,
  Equal,
  Hash,
  Milestone,
  Plus,
  Rocket,
  SquareCheck,
} from "lucide-react";
import { completeSprint, createSprint, setCardSprint, startSprint } from "../actions";

type CardType = "task" | "backlog_item" | "epic";
type CardPriority = "high" | "medium" | "low";
type SprintStatus = "planned" | "active" | "completed";

type BacklogCard = {
  id: string;
  number: number;
  title: string;
  type: CardType;
  priority: CardPriority;
  storyPoints: number | null;
  sprintId: string | null;
  dueDate: Date | null;
  isDone: boolean;
};

type BacklogSprint = {
  id: string;
  name: string;
  status: SprintStatus;
  startDate: Date;
  endDate: Date;
};

const CARD_TYPES: Record<CardType, { label: string; icon: typeof SquareCheck; color: string }> = {
  epic: { label: "Epic", icon: Milestone, color: "#9333ea" },
  backlog_item: { label: "Product Backlog Item", icon: Bookmark, color: "#d97706" },
  task: { label: "Task", icon: SquareCheck, color: "#4f46e5" },
};

const CARD_PRIORITIES: Record<CardPriority, { icon: typeof SquareCheck; color: string }> = {
  high: { icon: ArrowUp, color: "#f97316" },
  medium: { icon: Equal, color: "#ca8a04" },
  low: { icon: ArrowDown, color: "#3b82f6" },
};

function isCardOverdue(card: BacklogCard) {
  return card.dueDate !== null && !card.isDone && card.dueDate.getTime() < Date.now();
}

export function BacklogBoard({
  boardId,
  boardKey,
  hasDoneList,
  initialSprints,
  initialCards,
}: {
  boardId: string;
  boardKey: string;
  hasDoneList: boolean;
  initialSprints: BacklogSprint[];
  initialCards: BacklogCard[];
}) {
  const [sprintList, setSprintList] = useState(initialSprints);
  const [cardList, setCardList] = useState(initialCards);
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const activeSprint = sprintList.find((sprint) => sprint.status === "active");
  const plannedSprints = sprintList
    .filter((sprint) => sprint.status === "planned")
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const completedSprints = sprintList
    .filter((sprint) => sprint.status === "completed")
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  const moveTargets = [...(activeSprint ? [activeSprint] : []), ...plannedSprints];

  async function handleCreateSprint(name: string, startDate: string, endDate: string) {
    try {
      const { sprint } = await createSprint(boardId, name, startDate, endDate);
      setSprintList((prev) => [
        ...prev,
        {
          id: sprint.id,
          name: sprint.name,
          status: sprint.status as SprintStatus,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
        },
      ]);
      setShowCreateSprint(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't create sprint");
    }
  }

  async function handleStartSprint(sprintId: string) {
    try {
      await startSprint(sprintId);
      setSprintList((prev) =>
        prev.map((sprint) => (sprint.id === sprintId ? { ...sprint, status: "active" } : sprint)),
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't start sprint");
    }
  }

  async function handleCompleteSprint(sprintId: string) {
    try {
      await completeSprint(sprintId);
      setSprintList((prev) =>
        prev.map((sprint) => (sprint.id === sprintId ? { ...sprint, status: "completed" } : sprint)),
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't complete sprint");
    }
  }

  async function handleMoveCard(cardId: string, sprintId: string | null) {
    const previous = cardList;
    setCardList((prev) => prev.map((card) => (card.id === cardId ? { ...card, sprintId } : card)));
    try {
      await setCardSprint(cardId, sprintId);
    } catch (error) {
      setCardList(previous);
      window.alert(error instanceof Error ? error.message : "Couldn't move card");
    }
  }

  function groupSummary(sprintId: string | null) {
    const groupCards = cardList.filter((card) => card.sprintId === sprintId);
    const totalPoints = groupCards.reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
    const donePoints = groupCards
      .filter((card) => card.isDone)
      .reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
    const doneCount = groupCards.filter((card) => card.isDone).length;
    const typeCounts = (Object.keys(CARD_TYPES) as CardType[])
      .map((type) => ({ type, count: groupCards.filter((card) => card.type === type).length }))
      .filter(({ count }) => count > 0);
    return { cards: groupCards, totalPoints, donePoints, doneCount, typeCounts };
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-muted-foreground">Sprints</h1>
        <button
          type="button"
          onClick={() => setShowCreateSprint(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          New sprint
        </button>
      </div>

      {!hasDoneList && (
        <p className="rounded-md bg-accent-tint px-3 py-2 text-sm text-accent">
          Mark a list as &quot;Done&quot; on the board to track which cards are complete.
        </p>
      )}

      {activeSprint &&
        (() => {
          const { cards: groupCards, totalPoints, donePoints, doneCount, typeCounts } = groupSummary(
            activeSprint.id,
          );
          return (
            <SprintSection
              key={activeSprint.id}
              title={activeSprint.name}
              subtitle={`${activeSprint.startDate.toLocaleDateString("en-US")} – ${activeSprint.endDate.toLocaleDateString("en-US")}`}
              badge={{ label: "Active", className: "bg-accent-tint text-accent" }}
              action={
                <button
                  type="button"
                  onClick={() => handleCompleteSprint(activeSprint.id)}
                  className="cursor-pointer rounded-md border bg-card px-2.5 py-1 text-xs font-medium transition hover:bg-muted"
                >
                  Complete sprint
                </button>
              }
              summary={`${doneCount}/${groupCards.length} cards done${totalPoints > 0 ? ` · ${donePoints}/${totalPoints} points` : ""}`}
              typeCounts={typeCounts}
              boardKey={boardKey}
              cards={groupCards}
              collapsed={collapsedGroups.has(activeSprint.id)}
              onToggle={() => toggleGroup(activeSprint.id)}
              moveTargets={moveTargets}
              onMoveCard={handleMoveCard}
            />
          );
        })()}

      {plannedSprints.map((sprint) => {
        const { cards: groupCards, totalPoints, donePoints, doneCount, typeCounts } = groupSummary(sprint.id);
        return (
          <SprintSection
            key={sprint.id}
            title={sprint.name}
            subtitle={`${sprint.startDate.toLocaleDateString("en-US")} – ${sprint.endDate.toLocaleDateString("en-US")}`}
            badge={{ label: "Planned", className: "bg-muted text-muted-foreground" }}
            action={
              !activeSprint && (
                <button
                  type="button"
                  onClick={() => handleStartSprint(sprint.id)}
                  className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
                >
                  Start sprint
                </button>
              )
            }
            summary={`${doneCount}/${groupCards.length} cards done${totalPoints > 0 ? ` · ${donePoints}/${totalPoints} points` : ""}`}
            typeCounts={typeCounts}
            boardKey={boardKey}
            cards={groupCards}
            collapsed={collapsedGroups.has(sprint.id)}
            onToggle={() => toggleGroup(sprint.id)}
            moveTargets={moveTargets}
            onMoveCard={handleMoveCard}
          />
        );
      })}

      <div className="mt-2 flex flex-col gap-2">
        <div className="h-px w-full bg-border" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Backlog</span>
      </div>

      {(() => {
        const { cards: groupCards, typeCounts } = groupSummary(null);
        return (
          <SprintSection
            title="Unassigned cards"
            subtitle={null}
            badge={null}
            action={null}
            summary={`${groupCards.length} card${groupCards.length === 1 ? "" : "s"}`}
            typeCounts={typeCounts}
            boardKey={boardKey}
            cards={groupCards}
            collapsed={collapsedGroups.has("backlog")}
            onToggle={() => toggleGroup("backlog")}
            moveTargets={moveTargets}
            onMoveCard={handleMoveCard}
          />
        );
      })()}

      {completedSprints.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Past sprints</span>
          <ul className="flex flex-col gap-1">
            {completedSprints.map((sprint) => {
              const { cards: groupCards, doneCount } = groupSummary(sprint.id);
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
                    {doneCount}/{groupCards.length} done
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showCreateSprint && (
        <CreateSprintModal onClose={() => setShowCreateSprint(false)} onCreate={handleCreateSprint} />
      )}
    </div>
  );
}

function SprintSection({
  title,
  subtitle,
  badge,
  action,
  summary,
  typeCounts,
  boardKey,
  cards,
  collapsed,
  onToggle,
  moveTargets,
  onMoveCard,
}: {
  title: string;
  subtitle: string | null;
  badge: { label: string; className: string } | null;
  action: React.ReactNode;
  summary: string;
  typeCounts: { type: CardType; count: number }[];
  boardKey: string;
  cards: BacklogCard[];
  collapsed: boolean;
  onToggle: () => void;
  moveTargets: BacklogSprint[];
  onMoveCard: (cardId: string, sprintId: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 cursor-pointer items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium">{title}</span>
          {badge && (
            <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}>
              {badge.label}
            </span>
          )}
          {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
          <span className="text-xs text-muted-foreground">· {summary}</span>
        </button>
        {action}
      </div>

      {typeCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          {typeCounts.map(({ type, count }) => {
            const config = CARD_TYPES[type];
            const TypeIcon = config.icon;
            return (
              <span
                key={type}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
                style={{ color: config.color, backgroundColor: `${config.color}1a` }}
              >
                <TypeIcon className="h-3 w-3" />
                {config.label} {count}
              </span>
            );
          })}
        </div>
      )}

      {!collapsed && (
        <ul className="flex flex-col gap-1.5">
          {cards.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No cards here.</p>
          ) : (
            cards.map((card) => {
              const cardType = CARD_TYPES[card.type];
              const CardTypeIcon = cardType.icon;
              const cardPriority = CARD_PRIORITIES[card.priority];
              const CardPriorityIcon = cardPriority.icon;
              const isOverdue = isCardOverdue(card);
              return (
                <li
                  key={card.id}
                  className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-sm"
                >
                  <span
                    title={`Priority: ${card.priority}`}
                    className="inline-flex shrink-0 items-center rounded p-0.5"
                    style={{ color: cardPriority.color, backgroundColor: `${cardPriority.color}1a` }}
                  >
                    <CardPriorityIcon className="h-3 w-3" />
                  </span>
                  <span
                    title={cardType.label}
                    className="inline-flex shrink-0 items-center rounded p-0.5"
                    style={{ color: cardType.color, backgroundColor: `${cardType.color}1a` }}
                  >
                    <CardTypeIcon className="h-3 w-3" />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {boardKey}-{card.number}
                  </span>
                  <span className="flex-1 truncate">{card.title}</span>
                  {card.storyPoints !== null && (
                    <span className="flex shrink-0 items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      <Hash className="h-3 w-3" />
                      {card.storyPoints}
                    </span>
                  )}
                  {isOverdue && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-destructive">
                      <Calendar className="h-3 w-3" />
                      {card.dueDate!.toLocaleDateString("en-US")}
                    </span>
                  )}
                  {card.isDone ? (
                    <span
                      title="Completed cards can't be moved between sprints"
                      className="shrink-0 rounded bg-accent-tint px-2 py-1 text-xs font-medium text-accent"
                    >
                      Done
                    </span>
                  ) : (
                    <select
                      aria-label="Move to sprint"
                      value={card.sprintId ?? ""}
                      onChange={(event) => onMoveCard(card.id, event.target.value || null)}
                      className="shrink-0 rounded-md border bg-card px-2 py-1 text-xs text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                    >
                      <option value="__label__" disabled>
                        Move to sprint
                      </option>
                      <option value="">Backlog</option>
                      {moveTargets.map((sprint) => (
                        <option key={sprint.id} value={sprint.id}>
                          {sprint.name}
                        </option>
                      ))}
                    </select>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

function CreateSprintModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, startDate: string, endDate: string) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="animate-modal-in w-full max-w-sm rounded-lg border bg-card p-5 shadow-lg"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const name = (form.elements.namedItem("name") as HTMLInputElement).value;
            const startDate = (form.elements.namedItem("startDate") as HTMLInputElement).value;
            const endDate = (form.elements.namedItem("endDate") as HTMLInputElement).value;
            onCreate(name, startDate, endDate);
          }}
          className="flex flex-col gap-4"
        >
          <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <Rocket className="h-4 w-4" />
            New sprint
          </h2>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            Name
            <input
              name="name"
              placeholder="Sprint 2"
              autoFocus
              required
              className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
              Start date
              <input
                name="startDate"
                type="date"
                required
                className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
              End date
              <input
                name="endDate"
                type="date"
                required
                className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-md border bg-card px-3.5 py-1.5 text-sm font-medium transition hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="cursor-pointer rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
