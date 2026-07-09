"use client";

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlignLeft,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Bookmark,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Equal,
  Filter,
  GripVertical,
  Hash,
  History,
  Link2,
  ListChecks,
  MessageSquare,
  Pencil,
  Plus,
  Rocket,
  Search,
  SquareCheck,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import {
  blockMember,
  createCard,
  createChecklistItem,
  createComment,
  createLabel,
  createList,
  deleteCard,
  deleteChecklistItem,
  deleteComment,
  deleteLabel,
  deleteList,
  generateInviteLink,
  inviteMember,
  linkCards,
  moveCard,
  moveCardToBoard,
  removeMember,
  renameChecklistItem,
  completeSprint,
  createSprint,
  reorderCards,
  reorderLists,
  revokeInviteLink,
  setCardLabel,
  setCardMember,
  setCardPriority,
  setCardSprint,
  setCardType,
  setListDone,
  startSprint,
  toggleChecklistItem,
  unblockMember,
  unlinkCards,
  updateCard,
  updateComment,
  updateList,
} from "./actions";

type Label = { id: string; name: string; color: string };
type ChecklistItem = { id: string; title: string; completed: boolean };
type CardComment = {
  id: string;
  message: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
  updatedAt: Date | null;
};
type CardType = "task" | "backlog_item";
type CardPriority = "high" | "medium" | "low";
type LinkRelation = "blocks" | "is_blocked_by" | "relates_to";
type CardLink = { id: string; relation: LinkRelation; otherCardId: string };
type CardItem = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  labelIds: string[];
  memberIds: string[];
  checklistItems: ChecklistItem[];
  comments: CardComment[];
  type: CardType;
  priority: CardPriority;
  storyPoints: number | null;
  links: CardLink[];
  sprintId: string | null;
};

const CARD_TYPES: Record<CardType, { label: string; icon: typeof SquareCheck; color: string }> = {
  task: { label: "Task", icon: SquareCheck, color: "#4f46e5" },
  backlog_item: { label: "Product Backlog Item", icon: Bookmark, color: "#d97706" },
};

const CARD_PRIORITIES: Record<CardPriority, { label: string; icon: typeof SquareCheck; color: string }> = {
  high: { label: "High", icon: ArrowUp, color: "#f97316" },
  medium: { label: "Medium", icon: Equal, color: "#ca8a04" },
  low: { label: "Low", icon: ArrowDown, color: "#3b82f6" },
};

const LINK_RELATION_LABELS: Record<LinkRelation, string> = {
  blocks: "Blocks",
  is_blocked_by: "Is blocked by",
  relates_to: "Relates to",
};
type ListData = { id: string; title: string; isDoneList: boolean; cards: CardItem[] };
type CurrentSprint = {
  id: string;
  name: string;
  status: "planned" | "active";
  startDate: Date;
  endDate: Date;
};
type OtherBoard = { id: string; name: string; lists: { id: string; title: string }[] };
type CardUpdates = {
  title: string;
  description: string | null;
  dueDate: string | null;
  storyPoints: number | null;
};
type CardCreateDetails = {
  title: string;
  description: string | null;
  dueDate: string | null;
  type: CardType;
  priority: CardPriority;
  storyPoints: number | null;
  labelIds: string[];
  memberIds: string[];
  checklistItemTitles: string[];
};
type Member = { userId: string; email: string; displayName: string; status: string };
type AssignableMember = { userId: string; email: string; displayName: string };
type Activity = { id: string; message: string; actorName: string; createdAt: Date; cardId: string | null };

// Hoisted so this object's identity is stable across renders — passing a
// fresh literal here every render defeats dnd-kit's sensor memoization and
// causes the drag to restart (re-fire onDragStart) on every state update.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };

const iconButtonClass =
  "cursor-pointer rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground";

const MAX_VISIBLE_AVATARS = 10;

// Matches the fetch limit in page.tsx, so a long-running session never grows
// the feed past what a fresh page load would show anyway.
const MAX_ACTIVITIES = 200;

function avatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 60%, 45%)`;
}

function timeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function sprintCountdown(sprint: CurrentSprint) {
  if (sprint.status === "planned") {
    return { text: `Starts ${sprint.startDate.toLocaleDateString()}`, urgent: false };
  }
  const days = Math.ceil((sprint.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { text: `Overdue by ${Math.abs(days)}d`, urgent: true };
  if (days === 0) return { text: "Ends today", urgent: true };
  if (days === 1) return { text: "1 day left", urgent: true };
  return { text: `${days} days left`, urgent: days <= 3 };
}

type CardFilters = {
  filterMemberIds: string[];
  filterLabelIds: string[];
  filterTypes: CardType[];
  filterOverdueOnly: boolean;
};

function cardMatchesFilters(card: CardItem, filters: CardFilters, now: number) {
  if (filters.filterMemberIds.length > 0 && !filters.filterMemberIds.some((id) => card.memberIds.includes(id))) {
    return false;
  }
  if (filters.filterLabelIds.length > 0 && !filters.filterLabelIds.some((id) => card.labelIds.includes(id))) {
    return false;
  }
  if (filters.filterTypes.length > 0 && !filters.filterTypes.includes(card.type)) return false;
  if (filters.filterOverdueOnly && !(card.dueDate && card.dueDate.getTime() < now)) return false;
  return true;
}

function filterVisibleLists(lists: ListData[], filters: CardFilters): ListData[] {
  const now = Date.now();
  return lists.map((list) => ({
    ...list,
    cards: list.cards.filter((card) => cardMatchesFilters(card, filters, now)),
  }));
}

function ActivitySidebar({
  activities,
  collapsed,
  onToggleCollapsed,
}: {
  activities: Activity[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label="Show activity"
        className="flex w-10 shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-lg border bg-card py-3 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        <History className="h-4 w-4" />
      </button>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <History className="h-4 w-4" />
          Activity
        </span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Hide activity"
          className={iconButtonClass}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      {activities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {activities.map((activity) => (
            <li key={activity.id} className="flex gap-2">
              <span
                style={{ backgroundColor: avatarColor(activity.actorName) }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              >
                {activity.actorName.charAt(0).toUpperCase()}
              </span>
              <div className="flex flex-col gap-0.5 text-sm">
                <span className="leading-snug">
                  <span className="font-medium">{activity.actorName}</span> {activity.message}
                </span>
                <span className="text-xs text-muted-foreground">{timeAgo(activity.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {activities.length >= MAX_ACTIVITIES && (
        <p className="text-center text-xs text-muted-foreground/70">
          Showing the most recent {MAX_ACTIVITIES} activities
        </p>
      )}
    </aside>
  );
}

function MemberAvatarStack({
  ownerDisplayName,
  members,
  onClick,
}: {
  ownerDisplayName: string;
  members: Member[];
  onClick: () => void;
}) {
  const people = [
    { key: "owner", name: ownerDisplayName, isAdmin: true },
    ...members
      .filter((m) => m.status === "active")
      .map((m) => ({ key: m.userId, name: m.displayName, isAdmin: false })),
  ];
  const visible = people.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = people.length - visible.length;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Members (${people.length})`}
      className="flex cursor-pointer items-center gap-2 rounded-md border bg-card py-1.5 pl-1.5 pr-3 shadow-xs transition hover:bg-muted"
    >
      <div className="flex -space-x-2">
        {visible.map((person) => (
          <span
            key={person.key}
            title={person.name}
            style={{ backgroundColor: person.isAdmin ? "var(--primary)" : avatarColor(person.name) }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-card text-xs font-semibold text-white"
          >
            {person.name.charAt(0).toUpperCase()}
          </span>
        ))}
        {overflow > 0 && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-card bg-muted text-xs font-semibold text-muted-foreground">
            +{overflow}
          </span>
        )}
      </div>
      <span className="flex items-center gap-1 text-sm font-medium">
        <Users className="h-3.5 w-3.5" />
        Members
      </span>
    </button>
  );
}

export function Board({
  boardId,
  initialLists,
  initialLabels,
  isAdmin,
  ownerEmail,
  ownerDisplayName,
  initialMembers,
  initialInviteToken,
  assignableMembers,
  currentUserId,
  initialActivities,
  initialCurrentSprint,
  otherBoards,
}: {
  boardId: string;
  initialLists: ListData[];
  initialLabels: Label[];
  isAdmin: boolean;
  ownerEmail: string;
  ownerDisplayName: string;
  initialMembers: Member[];
  initialInviteToken: string | null;
  assignableMembers: AssignableMember[];
  currentUserId: string;
  initialActivities: Activity[];
  initialCurrentSprint: CurrentSprint | null;
  otherBoards: OtherBoard[];
}) {
  const [lists, setLists] = useState(initialLists);
  const [boardLabels, setBoardLabels] = useState(initialLabels);
  const [members, setMembers] = useState(initialMembers);
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [currentSprint, setCurrentSprint] = useState(initialCurrentSprint);
  const [showLabelText, setShowLabelText] = useState(false);
  const showLabelTextKey = `joinboard:showLabelText:${boardId}`;
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [creatingCardListId, setCreatingCardListId] = useState<string | null>(null);
  const [movingCardId, setMovingCardId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [filterMemberIds, setFilterMemberIds] = useState<string[]>([]);
  const [filterLabelIds, setFilterLabelIds] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<CardType[]>([]);
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);
  const [showFilterPicker, setShowFilterPicker] = useState(false);
  const [activities, setActivities] = useState(initialActivities);
  const [activityCollapsed, setActivityCollapsed] = useState(false);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  useEffect(() => {
    const stored = localStorage.getItem(showLabelTextKey);
    if (stored !== null) setShowLabelText(stored === "true");
  }, [showLabelTextKey]);

  function handleToggleLabelText() {
    setShowLabelText((prev) => {
      const next = !prev;
      localStorage.setItem(showLabelTextKey, String(next));
      return next;
    });
  }

  function pushActivity(
    activity: { id: string; message: string; createdAt: Date; cardId: string | null } | undefined,
  ) {
    if (!activity) return;
    const actorName =
      assignableMembers.find((member) => member.userId === currentUserId)?.displayName ?? "Someone";
    setActivities((prev) =>
      [
        { id: activity.id, message: activity.message, actorName, createdAt: activity.createdAt, cardId: activity.cardId },
        ...prev,
      ].slice(0, MAX_ACTIVITIES),
    );
  }

  function findListByCardId(cardId: string) {
    return lists.find((list) => list.cards.some((card) => card.id === cardId));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeList = findListByCardId(activeId);
    if (!activeList) return; // dragging a list itself — handled in onDragEnd

    const overList = findListByCardId(overId) ?? lists.find((list) => list.id === overId);
    if (!overList || activeList.id === overList.id) return;

    setLists((prev) => {
      const from = prev.find((list) => list.id === activeList.id);
      const to = prev.find((list) => list.id === overList.id);
      const card = from?.cards.find((c) => c.id === activeId);
      if (!from || !to || !card) return prev;

      const overIndex = to.cards.findIndex((c) => c.id === overId);

      return prev.map((list) => {
        if (list.id === from.id) {
          return { ...list, cards: list.cards.filter((c) => c.id !== activeId) };
        }
        if (list.id === to.id) {
          const nextCards = [...list.cards];
          nextCards.splice(overIndex === -1 ? nextCards.length : overIndex, 0, card);
          return { ...list, cards: nextCards };
        }
        return list;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const draggedListIndex = lists.findIndex((list) => list.id === activeId);
    if (draggedListIndex !== -1) {
      if (activeId === overId) return;
      const overIndex = lists.findIndex((list) => list.id === overId);
      if (overIndex === -1) return;

      const next = arrayMove(lists, draggedListIndex, overIndex);
      setLists(next);
      startTransition(() => {
        reorderLists(boardId, next.map((list) => list.id));
      });
      return;
    }

    // Cross-list moves are already applied to state by handleDragOver, so by
    // now `activeId`'s card lives in its final list — just fix intra-list
    // order and persist.
    const list = findListByCardId(activeId);
    if (!list) return;

    let finalCards = list.cards;
    const oldIndex = list.cards.findIndex((c) => c.id === activeId);
    const overIndex = list.cards.findIndex((c) => c.id === overId);
    if (oldIndex !== -1 && overIndex !== -1 && oldIndex !== overIndex) {
      finalCards = arrayMove(list.cards, oldIndex, overIndex);
      setLists((prev) =>
        prev.map((l) => (l.id === list.id ? { ...l, cards: finalCards } : l)),
      );
    }

    startTransition(() => {
      reorderCards(
        boardId,
        finalCards.map((card, index) => ({ id: card.id, listId: list.id, position: index })),
      ).then(({ activity }) => pushActivity(activity));
    });
  }

  async function handleAddList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("title") as HTMLInputElement;
    const title = input.value.trim();
    if (!title) return;
    input.value = "";

    const { list, activity } = await createList(boardId, title);
    setLists((prev) => [...prev, { id: list.id, title: list.title, isDoneList: false, cards: [] }]);
    pushActivity(activity);
  }

  async function handleCreateCard(listId: string, details: CardCreateDetails) {
    const { card, activity } = await createCard(listId, {
      title: details.title,
      description: details.description,
      dueDate: details.dueDate,
      type: details.type,
      priority: details.priority,
      storyPoints: details.storyPoints,
    });
    pushActivity(activity);

    const labelResults = await Promise.all(
      details.labelIds.map((labelId) => setCardLabel(card.id, labelId, true)),
    );
    labelResults.forEach((result) => pushActivity(result.activity));

    const memberResults = await Promise.all(
      details.memberIds.map((userId) => setCardMember(card.id, userId, true)),
    );
    memberResults.forEach((result) => pushActivity(result.activity));

    // Sequential so each item's auto-assigned position strictly increases.
    const checklistItems: ChecklistItem[] = [];
    for (const title of details.checklistItemTitles) {
      const { item, activity: itemActivity } = await createChecklistItem(card.id, title);
      checklistItems.push(item);
      pushActivity(itemActivity);
    }

    setLists((prev) =>
      prev.map((list) =>
        list.id === listId
          ? {
              ...list,
              cards: [
                ...list.cards,
                {
                  id: card.id,
                  title: card.title,
                  description: card.description,
                  dueDate: card.dueDate,
                  labelIds: details.labelIds,
                  memberIds: details.memberIds,
                  checklistItems,
                  comments: [],
                  type: card.type as CardType,
                  priority: card.priority as CardPriority,
                  storyPoints: card.storyPoints,
                  links: [],
                  sprintId: null,
                },
              ],
            }
          : list,
      ),
    );
    setCreatingCardListId(null);
  }

  async function handleRenameList(listId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      setEditingListId(null);
      return;
    }
    setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, title: trimmed } : l)));
    setEditingListId(null);
    const { activity } = await updateList(listId, trimmed);
    pushActivity(activity);
  }

  async function handleDeleteList(listId: string) {
    if (!window.confirm("Delete this list and all its cards?")) return;
    setLists((prev) => prev.filter((l) => l.id !== listId));
    const { activity } = await deleteList(listId);
    pushActivity(activity);
  }

  async function handleSaveCardDetail(cardId: string, updates: CardUpdates) {
    const trimmed = updates.title.trim();
    if (!trimmed) return;
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                title: trimmed,
                description: updates.description,
                dueDate: updates.dueDate ? new Date(updates.dueDate) : null,
              }
            : card,
        ),
      })),
    );
    setDetailCardId(null);
    const { activity } = await updateCard(cardId, { ...updates, title: trimmed });
    pushActivity(activity);
  }

  async function handleDeleteCard(cardId: string) {
    if (!window.confirm("Delete this card?")) return;
    setLists((prev) =>
      prev.map((list) => ({ ...list, cards: list.cards.filter((c) => c.id !== cardId) })),
    );
    setDetailCardId(null);
    const { activity } = await deleteCard(cardId);
    pushActivity(activity);
  }

  async function handleMoveCard(cardId: string, targetListId: string) {
    setLists((prev) => {
      const sourceList = prev.find((list) => list.cards.some((c) => c.id === cardId));
      const card = sourceList?.cards.find((c) => c.id === cardId);
      if (!sourceList || !card || sourceList.id === targetListId) return prev;

      return prev.map((list) => {
        if (list.id === sourceList.id) {
          return { ...list, cards: list.cards.filter((c) => c.id !== cardId) };
        }
        if (list.id === targetListId) {
          return { ...list, cards: [...list.cards, card] };
        }
        return list;
      });
    });
    const { activity } = await moveCard(cardId, targetListId);
    pushActivity(activity);
  }

  async function handleMoveCardToBoard(cardId: string, targetListId: string) {
    setLists((prev) => prev.map((list) => ({ ...list, cards: list.cards.filter((c) => c.id !== cardId) })));
    setMovingCardId(null);
    if (detailCardId === cardId) setDetailCardId(null);
    const { activity } = await moveCardToBoard(cardId, targetListId);
    pushActivity(activity);
  }

  async function handleSetCardType(cardId: string, type: CardType) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) => (card.id === cardId ? { ...card, type } : card)),
      })),
    );
    const { activity } = await setCardType(cardId, type);
    pushActivity(activity);
  }

  async function handleSetCardPriority(cardId: string, priority: CardPriority) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) => (card.id === cardId ? { ...card, priority } : card)),
      })),
    );
    const { activity } = await setCardPriority(cardId, priority);
    pushActivity(activity);
  }

  async function handleSetCardSprint(cardId: string, sprintId: string | null) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) => (card.id === cardId ? { ...card, sprintId } : card)),
      })),
    );
    const { activity } = await setCardSprint(cardId, sprintId);
    pushActivity(activity);
  }

  async function handleCreateSprint(name: string, startDate: string, endDate: string) {
    try {
      const { sprint, activity } = await createSprint(boardId, name, startDate, endDate);
      setCurrentSprint({
        id: sprint.id,
        name: sprint.name,
        status: sprint.status as "planned" | "active",
        startDate: sprint.startDate,
        endDate: sprint.endDate,
      });
      pushActivity(activity);
      setShowCreateSprint(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't create sprint");
    }
  }

  async function handleStartSprint(sprintId: string) {
    setCurrentSprint((prev) => (prev ? { ...prev, status: "active" } : prev));
    const { activity } = await startSprint(sprintId);
    pushActivity(activity);
  }

  async function handleCompleteSprint(sprintId: string) {
    setCurrentSprint(null);
    const { activity } = await completeSprint(sprintId);
    pushActivity(activity);
  }

  async function handleSetListDone(listId: string, isDone: boolean) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        isDoneList: list.id === listId ? isDone : isDone ? false : list.isDoneList,
      })),
    );
    const { activity } = await setListDone(listId, isDone);
    pushActivity(activity);
  }

  async function handleLinkCard(cardId: string, targetCardId: string, relation: LinkRelation) {
    try {
      const { link, activity } = await linkCards(cardId, targetCardId, relation);
      if (!link) return;
      setLists((prev) =>
        prev.map((list) => ({
          ...list,
          cards: list.cards.map((card) => {
            if (card.id === link.cardId) {
              const newLink: CardLink =
                link.type === "relates_to"
                  ? { id: link.id, relation: "relates_to", otherCardId: link.linkedCardId }
                  : { id: link.id, relation: "blocks", otherCardId: link.linkedCardId };
              return { ...card, links: [...card.links, newLink] };
            }
            if (card.id === link.linkedCardId) {
              const newLink: CardLink =
                link.type === "relates_to"
                  ? { id: link.id, relation: "relates_to", otherCardId: link.cardId }
                  : { id: link.id, relation: "is_blocked_by", otherCardId: link.cardId };
              return { ...card, links: [...card.links, newLink] };
            }
            return card;
          }),
        })),
      );
      pushActivity(activity);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't link cards");
    }
  }

  async function handleUnlinkCard(linkId: string) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) => ({
          ...card,
          links: card.links.filter((link) => link.id !== linkId),
        })),
      })),
    );
    const { activity } = await unlinkCards(linkId);
    pushActivity(activity);
  }

  async function handleCreateLabel(name: string, color: string) {
    const { label, activity } = await createLabel(boardId, name, color);
    setBoardLabels((prev) => [...prev, label]);
    pushActivity(activity);
  }

  async function handleDeleteLabel(labelId: string) {
    if (!window.confirm("Delete this label? It will be removed from every card.")) return;
    setBoardLabels((prev) => prev.filter((label) => label.id !== labelId));
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) => ({
          ...card,
          labelIds: card.labelIds.filter((id) => id !== labelId),
        })),
      })),
    );
    const { activity } = await deleteLabel(labelId);
    pushActivity(activity);
  }

  async function handleToggleCardLabel(cardId: string, labelId: string, assigned: boolean) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                labelIds: assigned
                  ? [...card.labelIds, labelId]
                  : card.labelIds.filter((id) => id !== labelId),
              }
            : card,
        ),
      })),
    );
    const { activity } = await setCardLabel(cardId, labelId, assigned);
    pushActivity(activity);
  }

  async function handleToggleCardMember(cardId: string, userId: string, assigned: boolean) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                memberIds: assigned
                  ? [...card.memberIds, userId]
                  : card.memberIds.filter((id) => id !== userId),
              }
            : card,
        ),
      })),
    );
    const { activity } = await setCardMember(cardId, userId, assigned);
    pushActivity(activity);
  }

  async function handleAddChecklistItem(cardId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const { item, activity } = await createChecklistItem(cardId, trimmed);
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) =>
          card.id === cardId
            ? { ...card, checklistItems: [...card.checklistItems, item] }
            : card,
        ),
      })),
    );
    pushActivity(activity);
  }

  async function handleRenameChecklistItem(cardId: string, itemId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                checklistItems: card.checklistItems.map((item) =>
                  item.id === itemId ? { ...item, title: trimmed } : item,
                ),
              }
            : card,
        ),
      })),
    );
    await renameChecklistItem(itemId, trimmed);
  }

  async function handleToggleChecklistItem(cardId: string, itemId: string, completed: boolean) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                checklistItems: card.checklistItems.map((item) =>
                  item.id === itemId ? { ...item, completed } : item,
                ),
              }
            : card,
        ),
      })),
    );
    const { activity } = await toggleChecklistItem(itemId, completed);
    pushActivity(activity);
  }

  async function handleDeleteChecklistItem(cardId: string, itemId: string) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) =>
          card.id === cardId
            ? { ...card, checklistItems: card.checklistItems.filter((item) => item.id !== itemId) }
            : card,
        ),
      })),
    );
    const { activity } = await deleteChecklistItem(itemId);
    pushActivity(activity);
  }

  async function handleAddComment(cardId: string, message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    const { comment, activity } = await createComment(cardId, trimmed);
    const authorName =
      assignableMembers.find((member) => member.userId === comment.userId)?.displayName ?? "Someone";
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                comments: [
                  {
                    id: comment.id,
                    message: comment.message,
                    authorId: comment.userId,
                    authorName,
                    createdAt: comment.createdAt,
                    updatedAt: comment.updatedAt,
                  },
                  ...card.comments,
                ],
              }
            : card,
        ),
      })),
    );
    pushActivity(activity);
  }

  async function handleUpdateComment(commentId: string, message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) => ({
          ...card,
          comments: card.comments.map((comment) =>
            comment.id === commentId ? { ...comment, message: trimmed, updatedAt: new Date() } : comment,
          ),
        })),
      })),
    );
    await updateComment(commentId, trimmed);
  }

  async function handleDeleteComment(commentId: string) {
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) => ({
          ...card,
          comments: card.comments.filter((comment) => comment.id !== commentId),
        })),
      })),
    );
    await deleteComment(commentId);
  }

  async function handleInvite(email: string) {
    try {
      const { activity, ...member } = await inviteMember(boardId, email);
      setMembers((prev) => [...prev.filter((m) => m.userId !== member.userId), member]);
      pushActivity(activity);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't send the invite");
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!window.confirm("Remove this member from the board?")) return;
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    const { activity } = await removeMember(boardId, userId);
    pushActivity(activity);
  }

  async function handleBlockMember(userId: string) {
    if (!window.confirm("Block this member? They will lose access immediately.")) return;
    setMembers((prev) =>
      prev.map((m) => (m.userId === userId ? { ...m, status: "blocked" } : m)),
    );
    const { activity } = await blockMember(boardId, userId);
    pushActivity(activity);
  }

  async function handleUnblockMember(userId: string) {
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    const { activity } = await unblockMember(boardId, userId);
    pushActivity(activity);
  }

  async function handleGenerateInviteLink() {
    const { token, activity } = await generateInviteLink(boardId);
    setInviteToken(token);
    pushActivity(activity);
  }

  async function handleRevokeInviteLink() {
    if (!window.confirm("Revoke this invite link? It will stop working immediately.")) return;
    setInviteToken(null);
    const { activity } = await revokeInviteLink(boardId);
    pushActivity(activity);
  }

  const detailCard = lists.flatMap((list) => list.cards).find((card) => card.id === detailCardId);
  const detailCardListId = lists.find((list) =>
    list.cards.some((card) => card.id === detailCardId),
  )?.id;
  const movingCard = lists.flatMap((list) => list.cards).find((card) => card.id === movingCardId);

  const doneList = lists.find((list) => list.isDoneList);
  const sprintCards = currentSprint
    ? lists.flatMap((list) => list.cards).filter((card) => card.sprintId === currentSprint.id)
    : [];
  const sprintDoneCount = doneList
    ? sprintCards.filter((card) => doneList.cards.some((c) => c.id === card.id)).length
    : 0;

  const hasActiveFilters =
    filterMemberIds.length > 0 || filterLabelIds.length > 0 || filterTypes.length > 0 || filterOverdueOnly;
  const activeFilterCount =
    filterMemberIds.length + filterLabelIds.length + filterTypes.length + (filterOverdueOnly ? 1 : 0);

  const visibleLists = hasActiveFilters
    ? filterVisibleLists(lists, { filterMemberIds, filterLabelIds, filterTypes, filterOverdueOnly })
    : lists;
  const totalCardCount = lists.reduce((sum, list) => sum + list.cards.length, 0);
  const visibleCardCount = visibleLists.reduce((sum, list) => sum + list.cards.length, 0);

  const searchResults = searchQuery.trim()
    ? lists
        .flatMap((list) => list.cards.map((card) => ({ card, listTitle: list.title })))
        .filter(({ card }) => card.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  function handleSelectSearchResult(cardId: string) {
    setDetailCardId(cardId);
    setSearchQuery("");
    setSearchDropdownOpen(false);
  }

  function clearFilters() {
    setFilterMemberIds([]);
    setFilterLabelIds([]);
    setFilterTypes([]);
    setFilterOverdueOnly(false);
  }

  return (
    <div className="flex flex-1 gap-4 overflow-hidden">
      <div className="flex flex-1 flex-col gap-4 overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <MemberAvatarStack
            ownerDisplayName={ownerDisplayName}
            members={members}
            onClick={() => setShowMembers(true)}
          />

          {currentSprint ? (
            <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
              <Rocket className="h-4 w-4 shrink-0 text-primary" />
              <div className="flex flex-col">
                <span className="text-sm font-medium">{currentSprint.name}</span>
                <span
                  className={`text-xs ${
                    sprintCountdown(currentSprint).urgent ? "font-medium text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {sprintCountdown(currentSprint).text}
                  {currentSprint.status === "active" && ` · ${sprintDoneCount}/${sprintCards.length} done`}
                </span>
              </div>
              {currentSprint.status === "planned" ? (
                <button
                  type="button"
                  onClick={() => handleStartSprint(currentSprint.id)}
                  className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
                >
                  Start sprint
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleCompleteSprint(currentSprint.id)}
                  className="cursor-pointer rounded-md border bg-card px-2.5 py-1 text-xs font-medium transition hover:bg-muted"
                >
                  Complete sprint
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreateSprint(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Rocket className="h-3.5 w-3.5" />
              No active sprint — start one
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setSearchDropdownOpen(true)}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchDropdownOpen(true);
              }}
              onBlur={() => setSearchDropdownOpen(false)}
              placeholder="Search cards…"
              className="w-full rounded-md border bg-card py-1.5 pl-8 pr-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
            {searchDropdownOpen && searchQuery.trim() && (
              <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card shadow-md">
                {searchResults.length > 0 ? (
                  searchResults.map(({ card, listTitle }) => {
                    const cardType = CARD_TYPES[card.type];
                    const TypeIcon = cardType.icon;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSelectSearchResult(card.id)}
                        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-sm transition hover:bg-muted"
                      >
                        <TypeIcon className="h-3.5 w-3.5 shrink-0" style={{ color: cardType.color }} />
                        <span className="flex-1 truncate">{card.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{listTitle}</span>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-2.5 py-2 text-sm text-muted-foreground">No cards found</p>
                )}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowFilterPicker((prev) => !prev)}
              className={
                showFilterPicker || activeFilterCount > 0
                  ? "flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition"
                  : "flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted"
              }
            >
              <Filter className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {showFilterPicker && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowFilterPicker(false)} />
                <div className="animate-modal-in absolute left-0 top-full z-30 mt-2 w-72 rounded-lg border bg-card p-4 shadow-lg">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold tracking-tight">Filters</h4>
                    <button
                      type="button"
                      onClick={() => setShowFilterPicker(false)}
                      aria-label="Close"
                      className={iconButtonClass}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Assignee</span>
                      <div className="flex flex-wrap gap-1.5">
                        {assignableMembers.map((member) => {
                          const active = filterMemberIds.includes(member.userId);
                          return (
                            <button
                              key={member.userId}
                              type="button"
                              onClick={() =>
                                setFilterMemberIds((prev) =>
                                  active ? prev.filter((id) => id !== member.userId) : [...prev, member.userId],
                                )
                              }
                              title={member.displayName}
                              className={
                                active
                                  ? "flex cursor-pointer items-center gap-1 rounded-full border-2 border-primary bg-primary-tint py-0.5 pl-0.5 pr-2 text-xs font-medium text-primary transition"
                                  : "flex cursor-pointer items-center gap-1 rounded-full border-2 border-transparent bg-muted py-0.5 pl-0.5 pr-2 text-xs font-medium text-muted-foreground transition hover:bg-border/60"
                              }
                            >
                              <span
                                style={{ backgroundColor: avatarColor(member.displayName) }}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                              >
                                {member.displayName.charAt(0).toUpperCase()}
                              </span>
                              {member.displayName}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {boardLabels.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">Labels</span>
                        <div className="flex flex-wrap gap-1.5">
                          {boardLabels.map((label) => {
                            const active = filterLabelIds.includes(label.id);
                            return (
                              <button
                                key={label.id}
                                type="button"
                                onClick={() =>
                                  setFilterLabelIds((prev) =>
                                    active ? prev.filter((id) => id !== label.id) : [...prev, label.id],
                                  )
                                }
                                style={
                                  active
                                    ? { backgroundColor: label.color, borderColor: label.color }
                                    : { borderColor: label.color, color: label.color }
                                }
                                className={
                                  active
                                    ? "cursor-pointer rounded-full border-2 px-2.5 py-1 text-xs font-medium text-white transition"
                                    : "cursor-pointer rounded-full border-2 bg-transparent px-2.5 py-1 text-xs font-medium transition"
                                }
                              >
                                {active ? `✓ ${label.name}` : label.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">Type</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(Object.entries(CARD_TYPES) as [CardType, (typeof CARD_TYPES)[CardType]][]).map(
                          ([value, config]) => {
                            const active = filterTypes.includes(value);
                            const TypeIcon = config.icon;
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  setFilterTypes((prev) =>
                                    active ? prev.filter((v) => v !== value) : [...prev, value],
                                  )
                                }
                                style={
                                  active
                                    ? { backgroundColor: config.color, borderColor: config.color }
                                    : { borderColor: config.color, color: config.color }
                                }
                                className={
                                  active
                                    ? "flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs font-medium text-white transition"
                                    : "flex cursor-pointer items-center gap-1.5 rounded-full border-2 bg-transparent px-2.5 py-1 text-xs font-medium transition"
                                }
                              >
                                <TypeIcon className="h-3.5 w-3.5" />
                                {config.label}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={filterOverdueOnly}
                        onChange={(event) => setFilterOverdueOnly(event.target.checked)}
                        className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                      />
                      Overdue only
                    </label>
                  </div>

                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="mt-3 cursor-pointer text-xs font-medium text-primary hover:underline"
                    >
                      Clear all filters
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {hasActiveFilters && (
            <span className="text-xs text-muted-foreground">
              {visibleCardCount} of {totalCardCount} cards
            </span>
          )}
        </div>

        <DndContext
          id={boardId}
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-1 items-start gap-4 overflow-x-auto pb-4">
            <SortableContext items={lists.map((list) => list.id)} strategy={horizontalListSortingStrategy}>
              {visibleLists.map((list) => (
                <SortableList
                  key={list.id}
                  list={list}
                  boardLabels={boardLabels}
                  assignableMembers={assignableMembers}
                  showLabelText={showLabelText}
                  onToggleLabelText={handleToggleLabelText}
                  currentSprint={currentSprint}
                  isEditing={editingListId === list.id}
                  onStartEdit={() => setEditingListId(list.id)}
                  onCancelEdit={() => setEditingListId(null)}
                  onRename={handleRenameList}
                  onDelete={handleDeleteList}
                  onToggleDone={handleSetListDone}
                  onAddCard={setCreatingCardListId}
                  onOpenCardDetail={setDetailCardId}
                  onDeleteCard={handleDeleteCard}
                  canMoveToBoard={otherBoards.length > 0}
                  onMoveToBoard={setMovingCardId}
                />
              ))}
            </SortableContext>

            <form
              onSubmit={handleAddList}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-dashed p-3"
            >
              <input
                name="title"
                placeholder="New list title"
                required
                className="rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="submit"
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" />
                Add list
              </button>
            </form>
          </div>

          {detailCard && detailCardListId && (
            <CardDetailModal
              key={detailCard.id}
              card={detailCard}
              boardLabels={boardLabels}
              assignableMembers={assignableMembers}
              currentUserId={currentUserId}
              lists={lists}
              currentListId={detailCardListId}
              onClose={() => setDetailCardId(null)}
              onSave={handleSaveCardDetail}
              onDelete={handleDeleteCard}
              onToggleLabel={handleToggleCardLabel}
              onCreateLabel={handleCreateLabel}
              onDeleteLabel={handleDeleteLabel}
              onMove={handleMoveCard}
              onToggleMember={handleToggleCardMember}
              onAddChecklistItem={handleAddChecklistItem}
              onRenameChecklistItem={handleRenameChecklistItem}
              onToggleChecklistItem={handleToggleChecklistItem}
              onDeleteChecklistItem={handleDeleteChecklistItem}
              onSetType={handleSetCardType}
              onSetPriority={handleSetCardPriority}
              currentSprint={currentSprint}
              onSetSprint={handleSetCardSprint}
              onLinkCard={handleLinkCard}
              onUnlinkCard={handleUnlinkCard}
              onNavigateToCard={setDetailCardId}
              activities={activities}
              onAddComment={handleAddComment}
              onUpdateComment={handleUpdateComment}
              onDeleteComment={handleDeleteComment}
            />
          )}

          {creatingCardListId && (
            <CreateCardModal
              boardLabels={boardLabels}
              assignableMembers={assignableMembers}
              currentUserId={currentUserId}
              onClose={() => setCreatingCardListId(null)}
              onCreate={(details) => handleCreateCard(creatingCardListId, details)}
              onCreateLabel={handleCreateLabel}
            />
          )}
        </DndContext>

        {showMembers && (
          <MembersModal
            isAdmin={isAdmin}
            ownerDisplayName={ownerDisplayName}
            members={members}
            inviteToken={inviteToken}
            onClose={() => setShowMembers(false)}
            onInvite={handleInvite}
            onRemove={handleRemoveMember}
            onBlock={handleBlockMember}
            onUnblock={handleUnblockMember}
            onGenerateInviteLink={handleGenerateInviteLink}
            onRevokeInviteLink={handleRevokeInviteLink}
          />
        )}

        {showCreateSprint && (
          <CreateSprintModal onClose={() => setShowCreateSprint(false)} onCreate={handleCreateSprint} />
        )}

        {movingCard && (
          <MoveCardToBoardModal
            cardTitle={movingCard.title}
            otherBoards={otherBoards}
            onClose={() => setMovingCardId(null)}
            onMove={(targetListId) => handleMoveCardToBoard(movingCard.id, targetListId)}
          />
        )}
      </div>
      <ActivitySidebar
        activities={activities}
        collapsed={activityCollapsed}
        onToggleCollapsed={() => setActivityCollapsed((prev) => !prev)}
      />
    </div>
  );
}

function SortableList({
  list,
  boardLabels,
  assignableMembers,
  showLabelText,
  onToggleLabelText,
  currentSprint,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onRename,
  onDelete,
  onToggleDone,
  onAddCard,
  onOpenCardDetail,
  onDeleteCard,
  canMoveToBoard,
  onMoveToBoard,
}: {
  list: ListData;
  boardLabels: Label[];
  assignableMembers: AssignableMember[];
  showLabelText: boolean;
  onToggleLabelText: () => void;
  currentSprint: CurrentSprint | null;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRename: (listId: string, title: string) => void;
  onDelete: (listId: string) => void;
  onToggleDone: (listId: string, isDone: boolean) => void;
  onAddCard: (listId: string) => void;
  onOpenCardDetail: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
  canMoveToBoard: boolean;
  onMoveToBoard: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/list flex w-72 shrink-0 flex-col rounded-lg border bg-card p-3 shadow-xs transition ${
        isDragging ? "opacity-60 shadow-md" : ""
      }`}
    >
      {isEditing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
            onRename(list.id, input.value);
          }}
          className="mb-2 flex gap-1.5"
        >
          <input
            name="title"
            defaultValue={list.title}
            autoFocus
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelEdit();
            }}
          />
          <button
            type="submit"
            className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
          >
            Save
          </button>
        </form>
      ) : (
        <div className="mb-2 flex items-center gap-1">
          <span {...attributes} {...listeners} className="cursor-grab text-muted-foreground">
            <GripVertical className="h-4 w-4" />
          </span>
          <span className="flex-1 truncate font-semibold tracking-tight">{list.title}</span>
          {list.isDoneList && (
            <span className="shrink-0 rounded bg-accent-tint px-1.5 py-0.5 text-[11px] font-medium text-accent">
              Done
            </span>
          )}
          <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover/list:opacity-100">
            <button
              type="button"
              onClick={() => onToggleDone(list.id, !list.isDoneList)}
              aria-label={list.isDoneList ? "Unmark as Done list" : "Mark as Done list"}
              title={list.isDoneList ? "Unmark as Done list" : "Mark as Done list"}
              className={list.isDoneList ? `${iconButtonClass} text-accent` : iconButtonClass}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onStartEdit} aria-label="Rename list" className={iconButtonClass}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(list.id)}
              aria-label="Delete list"
              className={`${iconButtonClass} hover:text-destructive`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <SortableContext items={list.cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <ul className="mb-2 flex min-h-2 flex-col gap-2">
          {list.cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              boardLabels={boardLabels}
              assignableMembers={assignableMembers}
              showLabelText={showLabelText}
              onToggleLabelText={onToggleLabelText}
              currentSprint={currentSprint}
              onOpenDetail={() => onOpenCardDetail(card.id)}
              onDelete={onDeleteCard}
              canMoveToBoard={canMoveToBoard}
              onMoveToBoard={onMoveToBoard}
            />
          ))}
        </ul>
      </SortableContext>

      <button
        type="button"
        onClick={() => onAddCard(list.id)}
        className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
      >
        <Plus className="h-4 w-4" />
        Add card
      </button>
    </div>
  );
}

function SortableCard({
  card,
  boardLabels,
  assignableMembers,
  showLabelText,
  onToggleLabelText,
  currentSprint,
  onOpenDetail,
  onDelete,
  canMoveToBoard,
  onMoveToBoard,
}: {
  card: CardItem;
  boardLabels: Label[];
  assignableMembers: AssignableMember[];
  showLabelText: boolean;
  onToggleLabelText: () => void;
  currentSprint: CurrentSprint | null;
  onOpenDetail: () => void;
  onDelete: (cardId: string) => void;
  canMoveToBoard: boolean;
  onMoveToBoard: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const cardLabels = boardLabels.filter((label) => card.labelIds.includes(label.id));
  const cardMembers = assignableMembers.filter((member) => card.memberIds.includes(member.userId));
  const cardType = CARD_TYPES[card.type];
  const CardTypeIcon = cardType.icon;
  const cardPriority = CARD_PRIORITIES[card.priority];
  const CardPriorityIcon = cardPriority.icon;

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group/card cursor-grab rounded-md border bg-card px-3 py-2.5 text-sm shadow-xs transition hover:shadow-md ${
        isDragging ? "opacity-60 shadow-md" : ""
      }`}
    >
      <div className="mb-1.5 flex items-center gap-1">
        <span
          title={`Priority: ${cardPriority.label}`}
          className="inline-flex shrink-0 items-center rounded p-0.5"
          style={{ color: cardPriority.color, backgroundColor: `${cardPriority.color}1a` }}
        >
          <CardPriorityIcon className="h-3 w-3" />
        </span>
        <span
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
          style={{ color: cardType.color, backgroundColor: `${cardType.color}1a` }}
        >
          <CardTypeIcon className="h-3 w-3" />
          {cardType.label}
        </span>
        {card.type === "backlog_item" && card.storyPoints !== null && (
          <span
            title={`${card.storyPoints} story point${card.storyPoints === 1 ? "" : "s"}`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            <Hash className="h-3 w-3" />
            {card.storyPoints}
          </span>
        )}
        {currentSprint && card.sprintId === currentSprint.id && (
          <span className="ml-1 inline-flex items-center gap-1 rounded bg-primary-tint px-1.5 py-0.5 text-[11px] font-medium text-primary">
            <Rocket className="h-3 w-3" />
            Sprint
          </span>
        )}
      </div>

      {cardLabels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {cardLabels.map((label) => (
            <button
              key={label.id}
              type="button"
              title={label.name}
              aria-label={`Toggle label text (${label.name})`}
              onClick={onToggleLabelText}
              style={{ backgroundColor: label.color }}
              className={
                showLabelText
                  ? "cursor-pointer rounded px-2 py-0.5 text-xs font-medium text-white"
                  : "h-2 w-8 cursor-pointer rounded-full"
              }
            >
              {showLabelText ? label.name : ""}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 leading-snug">{card.title}</span>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover/card:opacity-100">
          {canMoveToBoard && (
            <button
              type="button"
              onClick={() => onMoveToBoard(card.id)}
              aria-label="Move to another board"
              title="Move to another board"
              className={iconButtonClass}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={onOpenDetail} aria-label="Edit card" className={iconButtonClass}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(card.id)}
            aria-label="Delete card"
            className={`${iconButtonClass} hover:text-destructive`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenDetail}
        aria-label="Open card details"
        className="mt-1.5 flex w-full flex-col items-start gap-1 text-left"
      >
        {card.description && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <AlignLeft className="h-3 w-3 shrink-0" />
            <span className="line-clamp-1">{card.description}</span>
          </span>
        )}
        {card.dueDate && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            {card.dueDate.toLocaleDateString()}
          </span>
        )}
        {card.checklistItems.length > 0 && (
          <span
            className={`flex items-center gap-1 text-xs ${
              card.checklistItems.every((item) => item.completed)
                ? "text-accent"
                : "text-muted-foreground"
            }`}
          >
            <ListChecks className="h-3 w-3 shrink-0" />
            {card.checklistItems.filter((item) => item.completed).length}/{card.checklistItems.length}
          </span>
        )}
        {!card.description && !card.dueDate && card.checklistItems.length === 0 && (
          <span className="text-xs text-muted-foreground/70 hover:text-muted-foreground hover:underline">
            Add details…
          </span>
        )}
      </button>

      {cardMembers.length > 0 && (
        <div className="mt-1.5 flex -space-x-1.5">
          {cardMembers.map((member) => (
            <span
              key={member.userId}
              title={member.displayName}
              style={{ backgroundColor: avatarColor(member.displayName) }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-card text-[10px] font-semibold text-white"
            >
              {member.displayName.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function CardDetailModal({
  card,
  boardLabels,
  assignableMembers,
  currentUserId,
  lists,
  currentListId,
  onClose,
  onSave,
  onDelete,
  onToggleLabel,
  onCreateLabel,
  onDeleteLabel,
  onMove,
  onToggleMember,
  onAddChecklistItem,
  onRenameChecklistItem,
  onToggleChecklistItem,
  onDeleteChecklistItem,
  onSetType,
  onSetPriority,
  currentSprint,
  onSetSprint,
  onLinkCard,
  onUnlinkCard,
  onNavigateToCard,
  activities,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
}: {
  card: CardItem;
  boardLabels: Label[];
  assignableMembers: AssignableMember[];
  currentUserId: string;
  lists: ListData[];
  currentListId: string;
  onClose: () => void;
  onSave: (cardId: string, updates: CardUpdates) => void;
  onDelete: (cardId: string) => void;
  onToggleLabel: (cardId: string, labelId: string, assigned: boolean) => void;
  onCreateLabel: (name: string, color: string) => void;
  onDeleteLabel: (labelId: string) => void;
  onMove: (cardId: string, targetListId: string) => void;
  onToggleMember: (cardId: string, userId: string, assigned: boolean) => void;
  onAddChecklistItem: (cardId: string, title: string) => void;
  onRenameChecklistItem: (cardId: string, itemId: string, title: string) => void;
  onToggleChecklistItem: (cardId: string, itemId: string, completed: boolean) => void;
  onDeleteChecklistItem: (cardId: string, itemId: string) => void;
  onSetType: (cardId: string, type: CardType) => void;
  onSetPriority: (cardId: string, priority: CardPriority) => void;
  currentSprint: CurrentSprint | null;
  onSetSprint: (cardId: string, sprintId: string | null) => void;
  onLinkCard: (cardId: string, targetCardId: string, relation: LinkRelation) => void;
  onUnlinkCard: (linkId: string) => void;
  onNavigateToCard: (cardId: string) => void;
  activities: Activity[];
  onAddComment: (cardId: string, message: string) => void;
  onUpdateComment: (commentId: string, message: string) => void;
  onDeleteComment: (commentId: string) => void;
}) {
  const newLabelNameRef = useRef<HTMLInputElement>(null);
  const newLabelColorRef = useRef<HTMLInputElement>(null);
  const newChecklistItemRef = useRef<HTMLInputElement>(null);
  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const editCommentRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const renameChecklistItemRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [editingChecklistItemId, setEditingChecklistItemId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkDropdownOpen, setLinkDropdownOpen] = useState(false);
  const [linkRelation, setLinkRelation] = useState<LinkRelation>("relates_to");

  function commitChecklistRename(itemId: string) {
    const input = renameChecklistItemRefs.current[itemId];
    if (!input) return;
    onRenameChecklistItem(card.id, itemId, input.value);
    setEditingChecklistItemId(null);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const memberSearchResults = assignableMembers.filter((member) => {
    const query = memberQuery.trim().toLowerCase();
    return member.displayName.toLowerCase().includes(query) || member.email.toLowerCase().includes(query);
  });

  const allCards = lists.flatMap((list) => list.cards);
  const linkedCardIds = new Set(card.links.map((link) => link.otherCardId));
  const linkableCards = allCards.filter(
    (candidate) =>
      candidate.id !== card.id &&
      !linkedCardIds.has(candidate.id) &&
      candidate.title.toLowerCase().includes(linkQuery.trim().toLowerCase()),
  );

  const feedItems = [
    ...card.comments.map((comment) => ({ kind: "comment" as const, createdAt: comment.createdAt, comment })),
    ...activities
      .filter((item) => item.cardId === card.id)
      .map((activity) => ({ kind: "activity" as const, createdAt: activity.createdAt, activity })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="animate-modal-in grid max-h-[85vh] w-full max-w-4xl grid-cols-1 gap-6 overflow-y-auto rounded-lg border bg-card p-5 shadow-lg lg:grid-cols-[1fr_320px]"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const title = (form.elements.namedItem("title") as HTMLInputElement).value;
            const description = (form.elements.namedItem("description") as HTMLTextAreaElement).value;
            const dueDate = (form.elements.namedItem("dueDate") as HTMLInputElement).value;
            const storyPointsInput = form.elements.namedItem("storyPoints") as HTMLInputElement | null;
            const storyPoints = storyPointsInput ? storyPointsInput.value : String(card.storyPoints ?? "");
            onSave(card.id, {
              title,
              description: description || null,
              dueDate: dueDate || null,
              storyPoints: storyPoints === "" ? null : Number(storyPoints),
            });
          }}
          className="flex min-w-0 flex-col gap-4"
        >
          <input
            name="title"
            defaultValue={card.title}
            autoFocus
            className="rounded-md border bg-background px-2.5 py-2 text-base font-semibold tracking-tight outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
          />

          <div className="flex flex-wrap gap-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowLabelPicker((prev) => !prev)}
                className={
                  showLabelPicker
                    ? "flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition"
                    : "flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted"
                }
              >
                <Tag className="h-3.5 w-3.5" />
                Labels
              </button>
              {showLabelPicker && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowLabelPicker(false)} />
                  <div className="animate-modal-in absolute left-0 top-full z-30 mt-2 w-72 rounded-lg border bg-card p-4 shadow-lg">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold tracking-tight">Labels</h4>
                      <button
                        type="button"
                        onClick={() => setShowLabelPicker(false)}
                        aria-label="Close"
                        className={iconButtonClass}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {boardLabels.map((label) => {
                        const assigned = card.labelIds.includes(label.id);
                        return (
                          <div
                            key={label.id}
                            style={
                              assigned
                                ? { backgroundColor: label.color, borderColor: label.color }
                                : { borderColor: label.color, color: label.color }
                            }
                            className={
                              assigned
                                ? "group/label flex items-center gap-1 rounded-full border-2 py-1 pl-2.5 pr-1.5 text-xs font-medium text-white transition"
                                : "group/label flex items-center gap-1 rounded-full border-2 bg-transparent py-1 pl-2.5 pr-1.5 text-xs font-medium transition"
                            }
                          >
                            <button
                              type="button"
                              onClick={() => onToggleLabel(card.id, label.id, !assigned)}
                              className="cursor-pointer"
                            >
                              {assigned ? `✓ ${label.name}` : label.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteLabel(label.id)}
                              aria-label={`Delete label ${label.name}`}
                              className="cursor-pointer rounded-full p-0.5 opacity-0 transition hover:text-destructive group-hover/label:opacity-100"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        type="color"
                        defaultValue="#4f46e5"
                        ref={newLabelColorRef}
                        className="h-9 w-11 shrink-0 cursor-pointer rounded-md border bg-background p-1"
                      />
                      <input
                        type="text"
                        ref={newLabelNameRef}
                        placeholder="New label"
                        className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                      />
                      <button
                        type="button"
                        aria-label="Add label"
                        onClick={() => {
                          const name = newLabelNameRef.current?.value.trim();
                          if (!name) return;
                          onCreateLabel(name, newLabelColorRef.current!.value);
                          newLabelNameRef.current!.value = "";
                        }}
                        className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => onToggleMember(card.id, currentUserId, !card.memberIds.includes(currentUserId))}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted"
            >
              {card.memberIds.includes(currentUserId) ? "Leave" : "Join"}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMemberPicker((prev) => !prev)}
                className={
                  showMemberPicker
                    ? "flex cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition"
                    : "flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted"
                }
              >
                <Users className="h-3.5 w-3.5" />
                Members
              </button>
              {showMemberPicker && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowMemberPicker(false)} />
                  <div className="animate-modal-in absolute left-0 top-full z-30 mt-2 w-72 rounded-lg border bg-card p-4 shadow-lg">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold tracking-tight">Members</h4>
                      <button
                        type="button"
                        onClick={() => setShowMemberPicker(false)}
                        aria-label="Close"
                        className={iconButtonClass}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                      placeholder="Search members"
                      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                    />
                    <p className="mb-1.5 mt-3 text-xs font-semibold text-muted-foreground">Board members</p>
                    <ul className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
                      {memberSearchResults.length > 0 ? (
                        memberSearchResults.map((member) => {
                          const assigned = card.memberIds.includes(member.userId);
                          return (
                            <li key={member.userId}>
                              <button
                                type="button"
                                onClick={() => onToggleMember(card.id, member.userId, !assigned)}
                                className={
                                  assigned
                                    ? "flex w-full cursor-pointer items-center gap-2 rounded-md bg-primary-tint px-2 py-1.5 text-left text-sm transition"
                                    : "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted"
                                }
                              >
                                <span
                                  style={{ backgroundColor: avatarColor(member.displayName) }}
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                                >
                                  {member.displayName.charAt(0).toUpperCase()}
                                </span>
                                <span className="flex-1 truncate">{member.displayName}</span>
                                {assigned && <Check className="h-4 w-4 shrink-0 text-primary" />}
                              </button>
                            </li>
                          );
                        })
                      ) : (
                        <p className="px-2 py-1.5 text-sm text-muted-foreground">No members found</p>
                      )}
                    </ul>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTypePicker((prev) => !prev)}
                style={{ backgroundColor: CARD_TYPES[card.type].color, borderColor: CARD_TYPES[card.type].color }}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-white transition"
              >
                {(() => {
                  const TypeIcon = CARD_TYPES[card.type].icon;
                  return <TypeIcon className="h-3.5 w-3.5" />;
                })()}
                {CARD_TYPES[card.type].label}
              </button>
              {showTypePicker && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowTypePicker(false)} />
                  <div className="animate-modal-in absolute left-0 top-full z-30 mt-2 w-56 rounded-lg border bg-card p-2 shadow-lg">
                    {(Object.entries(CARD_TYPES) as [CardType, (typeof CARD_TYPES)[CardType]][]).map(
                      ([value, config]) => {
                        const selected = card.type === value;
                        const TypeIcon = config.icon;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              onSetType(card.id, value);
                              setShowTypePicker(false);
                            }}
                            className={
                              selected
                                ? "flex w-full cursor-pointer items-center gap-2 rounded-md bg-primary-tint px-2 py-1.5 text-left text-sm transition"
                                : "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted"
                            }
                          >
                            <TypeIcon className="h-3.5 w-3.5 shrink-0" style={{ color: config.color }} />
                            <span className="flex-1 truncate">{config.label}</span>
                            {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                          </button>
                        );
                      },
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowPriorityPicker((prev) => !prev)}
                style={{
                  backgroundColor: CARD_PRIORITIES[card.priority].color,
                  borderColor: CARD_PRIORITIES[card.priority].color,
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-white transition"
              >
                {(() => {
                  const PriorityIcon = CARD_PRIORITIES[card.priority].icon;
                  return <PriorityIcon className="h-3.5 w-3.5" />;
                })()}
                {CARD_PRIORITIES[card.priority].label}
              </button>
              {showPriorityPicker && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowPriorityPicker(false)} />
                  <div className="animate-modal-in absolute left-0 top-full z-30 mt-2 w-56 rounded-lg border bg-card p-2 shadow-lg">
                    {(
                      Object.entries(CARD_PRIORITIES) as [CardPriority, (typeof CARD_PRIORITIES)[CardPriority]][]
                    ).map(([value, config]) => {
                      const selected = card.priority === value;
                      const PriorityIcon = config.icon;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            onSetPriority(card.id, value);
                            setShowPriorityPicker(false);
                          }}
                          className={
                            selected
                              ? "flex w-full cursor-pointer items-center gap-2 rounded-md bg-primary-tint px-2 py-1.5 text-left text-sm transition"
                              : "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-muted"
                          }
                        >
                          <PriorityIcon className="h-3.5 w-3.5 shrink-0" style={{ color: config.color }} />
                          <span className="flex-1 truncate">{config.label}</span>
                          {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {card.labelIds.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Tag className="h-3.5 w-3.5" />
                Labels
              </span>
              <div className="flex flex-wrap gap-1.5">
                {boardLabels
                  .filter((label) => card.labelIds.includes(label.id))
                  .map((label) => (
                    <div
                      key={label.id}
                      style={{ backgroundColor: label.color, borderColor: label.color }}
                      className="group/label flex items-center gap-1 rounded-full border-2 py-1 pl-2.5 pr-1.5 text-xs font-medium text-white transition"
                    >
                      <button
                        type="button"
                        onClick={() => onToggleLabel(card.id, label.id, false)}
                        className="cursor-pointer"
                      >
                        {label.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleLabel(card.id, label.id, false)}
                        aria-label={`Remove label ${label.name}`}
                        className="cursor-pointer rounded-full p-0.5 opacity-0 transition hover:text-destructive group-hover/label:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {card.memberIds.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                Members
              </span>
              <div className="flex flex-wrap gap-1.5">
                {assignableMembers
                  .filter((member) => card.memberIds.includes(member.userId))
                  .map((member) => {
                    const isSelf = member.userId === currentUserId;
                    return (
                      <button
                        key={member.userId}
                        type="button"
                        title={member.displayName}
                        onClick={() => onToggleMember(card.id, member.userId, false)}
                        className="flex cursor-pointer items-center gap-1.5 rounded-full border-2 border-primary bg-primary-tint py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-primary transition"
                      >
                        <span
                          style={{ backgroundColor: avatarColor(member.displayName) }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        >
                          {member.displayName.charAt(0).toUpperCase()}
                        </span>
                        {isSelf ? "Leave" : `Remove ${member.displayName}`}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <AlignLeft className="h-3.5 w-3.5" />
              Description
            </span>
            <textarea
              name="description"
              defaultValue={card.description ?? ""}
              placeholder="Add a more detailed description…"
              rows={4}
              className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>

          {currentSprint && (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Rocket className="h-3.5 w-3.5" />
                Sprint
              </span>
              {card.sprintId === currentSprint.id ? (
                <button
                  type="button"
                  onClick={() => onSetSprint(card.id, null)}
                  className="flex cursor-pointer items-center gap-1.5 self-start rounded-full border-2 border-primary bg-primary-tint px-2.5 py-1 text-left text-xs font-medium text-primary transition"
                >
                  In &quot;{currentSprint.name}&quot; — remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetSprint(card.id, currentSprint.id)}
                  className="cursor-pointer self-start rounded-full border-2 border-transparent bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-border/60"
                >
                  Add to &quot;{currentSprint.name}&quot;
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Due date
              </span>
              <input
                name="dueDate"
                type="date"
                defaultValue={card.dueDate ? card.dueDate.toISOString().slice(0, 10) : ""}
                className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
              List
              <select
                value={currentListId}
                onChange={(event) => onMove(card.id, event.target.value)}
                className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              >
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title}
                  </option>
                ))}
              </select>
            </label>

            {card.type === "backlog_item" && (
              <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  Story points
                </span>
                <input
                  name="storyPoints"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={card.storyPoints ?? ""}
                  placeholder="Unestimated"
                  className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </label>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex cursor-pointer items-center gap-1 self-start text-sm font-medium text-primary hover:underline"
          >
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showAdvanced ? "Hide advanced options" : "Advanced options"}
          </button>

          {showAdvanced && (
            <>
              <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <ListChecks className="h-3.5 w-3.5" />
              Checklist
              {card.checklistItems.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground/70">
                  ({card.checklistItems.filter((item) => item.completed).length}/
                  {card.checklistItems.length})
                </span>
              )}
            </span>

            {card.checklistItems.length > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{
                    width: `${
                      (card.checklistItems.filter((item) => item.completed).length /
                        card.checklistItems.length) *
                      100
                    }%`,
                  }}
                />
              </div>
            )}

            {card.checklistItems.length > 0 && (
              <ul className="flex flex-col gap-1">
                {card.checklistItems.map((item) =>
                  editingChecklistItemId === item.id ? (
                    <li key={item.id}>
                      <div className="flex gap-1.5">
                        <input
                          ref={(el) => {
                            renameChecklistItemRefs.current[item.id] = el;
                          }}
                          defaultValue={item.title}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitChecklistRename(item.id);
                            }
                            if (event.key === "Escape") setEditingChecklistItemId(null);
                          }}
                          onBlur={() => setEditingChecklistItemId(null)}
                          className="flex-1 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                        />
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => commitChecklistRename(item.id)}
                          className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
                        >
                          Save
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li key={item.id} className="group/item flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={(event) =>
                          onToggleChecklistItem(card.id, item.id, event.target.checked)
                        }
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                      />
                      <button
                        type="button"
                        onClick={() => setEditingChecklistItemId(item.id)}
                        className={`flex-1 truncate text-left text-sm ${
                          item.completed ? "text-muted-foreground line-through" : ""
                        }`}
                      >
                        {item.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteChecklistItem(card.id, item.id)}
                        aria-label={`Delete checklist item ${item.title}`}
                        className="cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover/item:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                ref={newChecklistItemRef}
                placeholder="Add an item"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const title = newChecklistItemRef.current?.value.trim();
                    if (!title) return;
                    onAddChecklistItem(card.id, title);
                    newChecklistItemRef.current!.value = "";
                  }
                }}
                className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="button"
                onClick={() => {
                  const title = newChecklistItemRef.current?.value.trim();
                  if (!title) return;
                  onAddChecklistItem(card.id, title);
                  newChecklistItemRef.current!.value = "";
                }}
                className="flex cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Link2 className="h-3.5 w-3.5" />
              Linked cards
            </span>

            {card.links.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {card.links.map((link) => {
                  const otherCard = allCards.find((candidate) => candidate.id === link.otherCardId);
                  const otherCardType = otherCard ? CARD_TYPES[otherCard.type] : null;
                  const OtherTypeIcon = otherCardType?.icon;
                  return (
                    <li key={link.id} className="group/link flex items-center gap-2">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {LINK_RELATION_LABELS[link.relation]}
                      </span>
                      {otherCard && OtherTypeIcon && otherCardType ? (
                        <button
                          type="button"
                          onClick={() => onNavigateToCard(link.otherCardId)}
                          className="flex flex-1 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-left transition hover:border-primary hover:shadow-xs"
                        >
                          <OtherTypeIcon
                            className="h-3.5 w-3.5 shrink-0"
                            style={{ color: otherCardType.color }}
                          />
                          <span className="flex-1 truncate text-sm font-medium">{otherCard.title}</span>
                        </button>
                      ) : (
                        <span className="flex-1 truncate rounded-md border border-dashed px-2.5 py-1.5 text-sm text-muted-foreground">
                          (unknown card)
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onUnlinkCard(link.id)}
                        aria-label="Remove link"
                        className="cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover/link:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex gap-2">
              <select
                value={linkRelation}
                onChange={(event) => setLinkRelation(event.target.value as LinkRelation)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              >
                <option value="relates_to">Relates to</option>
                <option value="blocks">Blocks</option>
                <option value="is_blocked_by">Is blocked by</option>
              </select>

              <div className="relative flex-1">
                <input
                  type="text"
                  value={linkQuery}
                  onFocus={() => setLinkDropdownOpen(true)}
                  onChange={(event) => {
                    setLinkQuery(event.target.value);
                    setLinkDropdownOpen(true);
                  }}
                  onBlur={() => setLinkDropdownOpen(false)}
                  placeholder="Search cards…"
                  className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
                {linkDropdownOpen && (
                  <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border bg-card shadow-md">
                    {linkableCards.length > 0 ? (
                      linkableCards.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            onLinkCard(card.id, candidate.id, linkRelation);
                            setLinkQuery("");
                            setLinkDropdownOpen(false);
                          }}
                          className="flex w-full cursor-pointer items-center px-2.5 py-1.5 text-left text-sm transition hover:bg-muted"
                        >
                          {candidate.title}
                        </button>
                      ))
                    ) : (
                      <p className="px-2.5 py-1.5 text-sm text-muted-foreground">No cards found</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
            </>
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <button
              type="button"
              onClick={() => onDelete(card.id)}
              className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-destructive hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete card
            </button>
            <div className="flex gap-2">
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
                Save
              </button>
            </div>
          </div>
        </form>

        <div className="flex min-w-0 flex-col gap-3 lg:border-l lg:pl-6">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            <MessageSquare className="h-4 w-4" />
            Comments and activity
          </h3>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              const message = newCommentRef.current?.value ?? "";
              if (!message.trim()) return;
              onAddComment(card.id, message);
              if (newCommentRef.current) newCommentRef.current.value = "";
            }}
            className="flex flex-col gap-2"
          >
            <textarea
              ref={newCommentRef}
              placeholder="Write a comment…"
              rows={2}
              className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="submit"
              className="cursor-pointer self-end rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover active:scale-[0.98]"
            >
              Comment
            </button>
          </form>

          {feedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments or activity yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {feedItems.map((item) =>
                item.kind === "comment" ? (
                  <li key={item.comment.id} className="flex gap-2">
                    <span
                      style={{ backgroundColor: avatarColor(item.comment.authorName) }}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    >
                      {item.comment.authorName.charAt(0).toUpperCase()}
                    </span>
                    <div className="flex flex-1 flex-col gap-1">
                      <span className="text-sm leading-snug">
                        <span className="font-medium">{item.comment.authorName}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(item.comment.createdAt)}
                          {item.comment.updatedAt && " (edited)"}
                        </span>
                      </span>
                      {editingCommentId === item.comment.id ? (
                        <div className="flex flex-col gap-1.5">
                          <textarea
                            ref={(el) => {
                              editCommentRefs.current[item.comment.id] = el;
                            }}
                            defaultValue={item.comment.message}
                            autoFocus
                            rows={2}
                            className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const value = editCommentRefs.current[item.comment.id]?.value ?? "";
                                onUpdateComment(item.comment.id, value);
                                setEditingCommentId(null);
                              }}
                              className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCommentId(null)}
                              className="cursor-pointer rounded-md border bg-card px-2.5 py-1 text-xs font-medium transition hover:bg-muted"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="rounded-md bg-muted px-2.5 py-1.5 text-sm whitespace-pre-wrap">
                            {item.comment.message}
                          </p>
                          {item.comment.authorId === currentUserId && (
                            <div className="flex gap-2 text-xs text-muted-foreground">
                              <button
                                type="button"
                                onClick={() => setEditingCommentId(item.comment.id)}
                                className="cursor-pointer hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteComment(item.comment.id)}
                                className="cursor-pointer hover:text-destructive hover:underline"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                ) : (
                  <li key={item.activity.id} className="flex gap-2">
                    <span
                      style={{ backgroundColor: avatarColor(item.activity.actorName) }}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    >
                      {item.activity.actorName.charAt(0).toUpperCase()}
                    </span>
                    <div className="flex flex-col gap-0.5 text-sm">
                      <span className="leading-snug">
                        <span className="font-medium">{item.activity.actorName}</span> {item.activity.message}
                      </span>
                      <span className="text-xs text-muted-foreground">{timeAgo(item.activity.createdAt)}</span>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateCardModal({
  boardLabels,
  assignableMembers,
  currentUserId,
  onClose,
  onCreate,
  onCreateLabel,
}: {
  boardLabels: Label[];
  assignableMembers: AssignableMember[];
  currentUserId: string;
  onClose: () => void;
  onCreate: (details: CardCreateDetails) => void;
  onCreateLabel: (name: string, color: string) => void;
}) {
  const [type, setType] = useState<CardType>("task");
  const [priority, setPriority] = useState<CardPriority>("medium");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [draftChecklistItems, setDraftChecklistItems] = useState<{ id: string; title: string }[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberDropdownOpen, setMemberDropdownOpen] = useState(false);
  const newLabelNameRef = useRef<HTMLInputElement>(null);
  const newLabelColorRef = useRef<HTMLInputElement>(null);
  const newChecklistItemRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function toggleLabel(labelId: string, assigned: boolean) {
    setSelectedLabelIds((prev) => (assigned ? [...prev, labelId] : prev.filter((id) => id !== labelId)));
  }

  function toggleMember(userId: string, assigned: boolean) {
    setSelectedMemberIds((prev) => (assigned ? [...prev, userId] : prev.filter((id) => id !== userId)));
  }

  function addChecklistItem() {
    const title = newChecklistItemRef.current?.value.trim();
    if (!title) return;
    setDraftChecklistItems((prev) => [...prev, { id: crypto.randomUUID(), title }]);
    newChecklistItemRef.current!.value = "";
  }

  const unassignedMembers = assignableMembers.filter((member) => {
    const query = memberQuery.trim().toLowerCase();
    return (
      !selectedMemberIds.includes(member.userId) &&
      (member.displayName.toLowerCase().includes(query) || member.email.toLowerCase().includes(query))
    );
  });

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="animate-modal-in max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-5 shadow-lg"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const title = (form.elements.namedItem("title") as HTMLInputElement).value;
            const description = (form.elements.namedItem("description") as HTMLTextAreaElement).value;
            const dueDate = (form.elements.namedItem("dueDate") as HTMLInputElement).value;
            const storyPointsInput = form.elements.namedItem("storyPoints") as HTMLInputElement | null;
            const storyPoints = storyPointsInput ? storyPointsInput.value : "";
            if (!title.trim()) return;
            onCreate({
              title,
              description: description || null,
              dueDate: dueDate || null,
              type,
              priority,
              storyPoints: storyPoints === "" ? null : Number(storyPoints),
              labelIds: selectedLabelIds,
              memberIds: selectedMemberIds,
              checklistItemTitles: draftChecklistItems.map((item) => item.title),
            });
          }}
          className="flex flex-col gap-4"
        >
          <h2 className="text-base font-semibold tracking-tight">Add card</h2>

          <input
            name="title"
            placeholder="Card title"
            autoFocus
            required
            className="rounded-md border bg-background px-2.5 py-2 text-base font-semibold tracking-tight outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
          />

          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <AlignLeft className="h-3.5 w-3.5" />
              Description
            </span>
            <textarea
              name="description"
              placeholder="Add a more detailed description…"
              rows={4}
              className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(CARD_TYPES) as [CardType, (typeof CARD_TYPES)[CardType]][]).map(
                ([value, config]) => {
                  const selected = type === value;
                  const TypeIcon = config.icon;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setType(value)}
                      style={
                        selected
                          ? { backgroundColor: config.color, borderColor: config.color }
                          : { borderColor: config.color, color: config.color }
                      }
                      className={
                        selected
                          ? "flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-left text-xs font-medium text-white transition"
                          : "flex cursor-pointer items-center gap-1.5 rounded-full border-2 bg-transparent px-2.5 py-1 text-left text-xs font-medium transition"
                      }
                    >
                      <TypeIcon className="h-3.5 w-3.5" />
                      {config.label}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">Priority</span>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(CARD_PRIORITIES) as [CardPriority, (typeof CARD_PRIORITIES)[CardPriority]][]).map(
                ([value, config]) => {
                  const selected = priority === value;
                  const PriorityIcon = config.icon;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPriority(value)}
                      style={
                        selected
                          ? { backgroundColor: config.color, borderColor: config.color }
                          : { borderColor: config.color, color: config.color }
                      }
                      className={
                        selected
                          ? "flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-left text-xs font-medium text-white transition"
                          : "flex cursor-pointer items-center gap-1.5 rounded-full border-2 bg-transparent px-2.5 py-1 text-left text-xs font-medium transition"
                      }
                    >
                      <PriorityIcon className="h-3.5 w-3.5" />
                      {config.label}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                Due date
              </span>
              <input
                name="dueDate"
                type="date"
                className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
            </label>

            {type === "backlog_item" && (
              <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  Story points
                </span>
                <input
                  name="storyPoints"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Unestimated"
                  className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </label>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex cursor-pointer items-center gap-1 self-start text-sm font-medium text-primary hover:underline"
          >
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showAdvanced ? "Hide advanced options" : "Advanced options"}
          </button>

          {showAdvanced && (
            <>
              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Tag className="h-3.5 w-3.5" />
                  Labels
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {boardLabels.map((label) => {
                    const assigned = selectedLabelIds.includes(label.id);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => toggleLabel(label.id, !assigned)}
                        style={
                          assigned
                            ? { backgroundColor: label.color, borderColor: label.color }
                            : { borderColor: label.color, color: label.color }
                        }
                        className={
                          assigned
                            ? "cursor-pointer rounded-full border-2 px-2.5 py-1 text-left text-xs font-medium text-white transition"
                            : "cursor-pointer rounded-full border-2 bg-transparent px-2.5 py-1 text-left text-xs font-medium transition"
                        }
                      >
                        {assigned ? `✓ ${label.name}` : label.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <input
                    type="color"
                    defaultValue="#4f46e5"
                    ref={newLabelColorRef}
                    className="h-9 w-11 cursor-pointer rounded-md border bg-background p-1"
                  />
                  <input
                    type="text"
                    ref={newLabelNameRef}
                    placeholder="New label"
                    className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                  <button
                    type="button"
                    aria-label="Add label"
                    onClick={() => {
                      const name = newLabelNameRef.current?.value.trim();
                      if (!name) return;
                      onCreateLabel(name, newLabelColorRef.current!.value);
                      newLabelNameRef.current!.value = "";
                    }}
                    className="flex cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Members
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {assignableMembers
                .filter((member) => selectedMemberIds.includes(member.userId))
                .map((member) => {
                  const isSelf = member.userId === currentUserId;
                  return (
                    <button
                      key={member.userId}
                      type="button"
                      title={member.displayName}
                      onClick={() => toggleMember(member.userId, false)}
                      className="flex cursor-pointer items-center gap-1.5 rounded-full border-2 border-primary bg-primary-tint py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-primary transition"
                    >
                      <span
                        style={{ backgroundColor: avatarColor(member.displayName) }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      >
                        {member.displayName.charAt(0).toUpperCase()}
                      </span>
                      {isSelf ? "Leave" : `Remove ${member.displayName}`}
                    </button>
                  );
                })}
              {!selectedMemberIds.includes(currentUserId) && (
                <button
                  type="button"
                  onClick={() => toggleMember(currentUserId, true)}
                  className="cursor-pointer rounded-full border-2 border-transparent bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-border/60"
                >
                  Join
                </button>
              )}
            </div>

            <div className="relative">
              <input
                type="text"
                value={memberQuery}
                onFocus={() => setMemberDropdownOpen(true)}
                onChange={(event) => {
                  setMemberQuery(event.target.value);
                  setMemberDropdownOpen(true);
                }}
                onBlur={() => setMemberDropdownOpen(false)}
                placeholder="Assign to…"
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
              {memberDropdownOpen && (
                <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border bg-card shadow-md">
                  {unassignedMembers.length > 0 ? (
                    unassignedMembers.map((member) => (
                      <button
                        key={member.userId}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          toggleMember(member.userId, true);
                          setMemberQuery("");
                          setMemberDropdownOpen(false);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-sm transition hover:bg-muted"
                      >
                        <span
                          style={{ backgroundColor: avatarColor(member.displayName) }}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        >
                          {member.displayName.charAt(0).toUpperCase()}
                        </span>
                        {member.displayName}
                      </button>
                    ))
                  ) : (
                    <p className="px-2.5 py-1.5 text-sm text-muted-foreground">No members found</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <ListChecks className="h-3.5 w-3.5" />
              Checklist
            </span>

            {draftChecklistItems.length > 0 && (
              <ul className="flex flex-col gap-1">
                {draftChecklistItems.map((item) => (
                  <li key={item.id} className="group/item flex items-center gap-2">
                    <span className="flex-1 truncate text-sm">{item.title}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftChecklistItems((prev) => prev.filter((i) => i.id !== item.id))
                      }
                      aria-label={`Remove checklist item ${item.title}`}
                      className="cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover/item:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                ref={newChecklistItemRef}
                placeholder="Add an item"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addChecklistItem();
                  }
                }}
                className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="button"
                onClick={addChecklistItem}
                className="flex cursor-pointer items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
          </div>
            </>
          )}

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
              Add card
            </button>
          </div>
        </form>
      </div>
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
              placeholder="Sprint 1"
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
              Create sprint
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MoveCardToBoardModal({
  cardTitle,
  otherBoards,
  onClose,
  onMove,
}: {
  cardTitle: string;
  otherBoards: OtherBoard[];
  onClose: () => void;
  onMove: (targetListId: string) => void;
}) {
  const [selectedBoard, setSelectedBoard] = useState<OtherBoard | null>(null);

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
        className="animate-modal-in flex max-h-[85vh] w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-5 shadow-lg"
      >
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <ArrowRightLeft className="h-4 w-4" />
            Move to another board
          </h2>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">&quot;{cardTitle}&quot;</p>
        </div>

        {selectedBoard ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setSelectedBoard(null)}
              className="flex cursor-pointer items-center gap-1 self-start text-sm font-medium text-primary hover:underline"
            >
              ← Back to boards
            </button>
            <span className="text-sm font-medium text-muted-foreground">
              Choose a list on &quot;{selectedBoard.name}&quot;
            </span>
            {selectedBoard.lists.length === 0 ? (
              <p className="text-sm text-muted-foreground">This board has no lists yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {selectedBoard.lists.map((list) => (
                  <li key={list.id}>
                    <button
                      type="button"
                      onClick={() => onMove(list.id)}
                      className="w-full cursor-pointer rounded-md border px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-primary-tint"
                    >
                      {list.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {otherBoards.map((board) => (
              <li key={board.id}>
                <button
                  type="button"
                  onClick={() => setSelectedBoard(board)}
                  className="w-full cursor-pointer rounded-md border px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-primary-tint"
                >
                  {board.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-end border-t pt-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border bg-card px-3.5 py-1.5 text-sm font-medium transition hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function statusBadgeClass(status: string) {
  if (status === "active") return "bg-accent-tint text-accent";
  if (status === "blocked") return "bg-destructive-tint text-destructive";
  return "bg-primary-tint text-primary";
}

function statusLabel(status: string) {
  if (status === "active") return "Active";
  if (status === "blocked") return "Blocked";
  return "Invited";
}

function MembersModal({
  isAdmin,
  ownerDisplayName,
  members,
  inviteToken,
  onClose,
  onInvite,
  onRemove,
  onBlock,
  onUnblock,
  onGenerateInviteLink,
  onRevokeInviteLink,
}: {
  isAdmin: boolean;
  ownerDisplayName: string;
  members: Member[];
  inviteToken: string | null;
  onClose: () => void;
  onInvite: (email: string) => void;
  onRemove: (userId: string) => void;
  onBlock: (userId: string) => void;
  onUnblock: (userId: string) => void;
  onGenerateInviteLink: () => void;
  onRevokeInviteLink: () => void;
}) {
  const inviteEmailRef = useRef<HTMLInputElement>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const inviteLink =
    inviteToken && typeof window !== "undefined"
      ? `${window.location.origin}/invite/${inviteToken}`
      : null;

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
        className="animate-modal-in w-full max-w-md rounded-lg border bg-card p-5 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <Users className="h-4 w-4" />
            Members
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={iconButtonClass}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mb-4 flex flex-col gap-2">
          <li className="flex items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {ownerDisplayName.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 truncate">{ownerDisplayName}</span>
            <span className="rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">
              Admin
            </span>
          </li>
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm"
            >
              <span
                style={{ backgroundColor: avatarColor(member.displayName) }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              >
                {member.displayName.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 truncate">{member.displayName}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(member.status)}`}>
                {statusLabel(member.status)}
              </span>
              {isAdmin && (
                <div className="flex gap-3 text-xs font-medium">
                  {member.status === "active" && (
                    <>
                      <button type="button" onClick={() => onRemove(member.userId)} className="cursor-pointer hover:underline">
                        Kick
                      </button>
                      <button
                        type="button"
                        onClick={() => onBlock(member.userId)}
                        className="cursor-pointer text-destructive hover:underline"
                      >
                        Block
                      </button>
                    </>
                  )}
                  {member.status === "invited" && (
                    <>
                      <button type="button" onClick={() => onInvite(member.email)} className="cursor-pointer hover:underline">
                        Re-invite
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(member.userId)}
                        className="cursor-pointer text-destructive hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {member.status === "blocked" && (
                    <button type="button" onClick={() => onUnblock(member.userId)} className="cursor-pointer hover:underline">
                      Unblock
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {isAdmin && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const email = inviteEmailRef.current?.value.trim();
              if (!email) return;
              onInvite(email);
              inviteEmailRef.current!.value = "";
            }}
            className="mb-4 flex gap-2"
          >
            <input
              type="email"
              ref={inviteEmailRef}
              placeholder="Invite by email"
              required
              className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
            <button
              type="submit"
              className="cursor-pointer rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary-hover"
            >
              Invite
            </button>
          </form>
        )}

        {isAdmin && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Link2 className="h-3.5 w-3.5" />
              Invite link
            </span>
            {inviteLink ? (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    onFocus={(event) => event.currentTarget.select()}
                    className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-muted"
                  >
                    {linkCopied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
                    {linkCopied ? "Copied" : "Copy"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onRevokeInviteLink}
                  className="cursor-pointer self-start text-sm font-medium text-destructive hover:underline"
                >
                  Revoke link
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onGenerateInviteLink}
                className="flex cursor-pointer items-center gap-1.5 self-start rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition hover:bg-muted"
              >
                <Link2 className="h-3.5 w-3.5" />
                Create invite link
              </button>
            )}
            <p className="text-xs text-muted-foreground">
              Anyone with this link can join the board — including people without an
              account yet. Sharing is up to you (chat, email, wherever).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
