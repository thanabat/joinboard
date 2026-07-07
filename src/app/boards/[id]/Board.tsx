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
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import {
  blockMember,
  createCard,
  createLabel,
  createList,
  deleteCard,
  deleteLabel,
  deleteList,
  generateInviteLink,
  inviteMember,
  moveCard,
  removeMember,
  renameCard,
  reorderCards,
  reorderLists,
  revokeInviteLink,
  setCardLabel,
  unblockMember,
  updateCard,
  updateList,
} from "./actions";

type Label = { id: string; name: string; color: string };
type CardItem = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  labelIds: string[];
};
type ListData = { id: string; title: string; cards: CardItem[] };
type CardUpdates = { title: string; description: string | null; dueDate: string | null };
type Member = { userId: string; email: string; status: string };

// Hoisted so this object's identity is stable across renders — passing a
// fresh literal here every render defeats dnd-kit's sensor memoization and
// causes the drag to restart (re-fire onDragStart) on every state update.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };

export function Board({
  boardId,
  initialLists,
  initialLabels,
  isAdmin,
  ownerEmail,
  initialMembers,
  initialInviteToken,
}: {
  boardId: string;
  initialLists: ListData[];
  initialLabels: Label[];
  isAdmin: boolean;
  ownerEmail: string;
  initialMembers: Member[];
  initialInviteToken: string | null;
}) {
  const [lists, setLists] = useState(initialLists);
  const [boardLabels, setBoardLabels] = useState(initialLabels);
  const [members, setMembers] = useState(initialMembers);
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [showLabelText, setShowLabelText] = useState(false);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingCardTitleId, setEditingCardTitleId] = useState<string | null>(null);
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

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
      );
    });
  }

  async function handleAddList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("title") as HTMLInputElement;
    const title = input.value.trim();
    if (!title) return;
    input.value = "";

    const list = await createList(boardId, title);
    setLists((prev) => [...prev, { id: list.id, title: list.title, cards: [] }]);
  }

  async function handleAddCard(listId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("title") as HTMLInputElement;
    const title = input.value.trim();
    if (!title) return;
    input.value = "";

    const card = await createCard(listId, title);
    setLists((prev) =>
      prev.map((list) =>
        list.id === listId
          ? {
              ...list,
              cards: [
                ...list.cards,
                { id: card.id, title: card.title, description: null, dueDate: null, labelIds: [] },
              ],
            }
          : list,
      ),
    );
  }

  async function handleRenameList(listId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      setEditingListId(null);
      return;
    }
    setLists((prev) => prev.map((l) => (l.id === listId ? { ...l, title: trimmed } : l)));
    setEditingListId(null);
    await updateList(listId, trimmed);
  }

  async function handleDeleteList(listId: string) {
    if (!window.confirm("Delete this list and all its cards?")) return;
    setLists((prev) => prev.filter((l) => l.id !== listId));
    await deleteList(listId);
  }

  async function handleRenameCard(cardId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) {
      setEditingCardTitleId(null);
      return;
    }
    setLists((prev) =>
      prev.map((list) => ({
        ...list,
        cards: list.cards.map((card) => (card.id === cardId ? { ...card, title: trimmed } : card)),
      })),
    );
    setEditingCardTitleId(null);
    await renameCard(cardId, trimmed);
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
    await updateCard(cardId, { ...updates, title: trimmed });
  }

  async function handleDeleteCard(cardId: string) {
    if (!window.confirm("Delete this card?")) return;
    setLists((prev) =>
      prev.map((list) => ({ ...list, cards: list.cards.filter((c) => c.id !== cardId) })),
    );
    setDetailCardId(null);
    await deleteCard(cardId);
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
    await moveCard(cardId, targetListId);
  }

  async function handleCreateLabel(name: string, color: string) {
    const label = await createLabel(boardId, name, color);
    setBoardLabels((prev) => [...prev, label]);
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
    await deleteLabel(labelId);
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
    await setCardLabel(cardId, labelId, assigned);
  }

  async function handleInvite(email: string) {
    try {
      const member = await inviteMember(boardId, email);
      setMembers((prev) => [...prev.filter((m) => m.userId !== member.userId), member]);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't send the invite");
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!window.confirm("Remove this member from the board?")) return;
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    await removeMember(boardId, userId);
  }

  async function handleBlockMember(userId: string) {
    if (!window.confirm("Block this member? They will lose access immediately.")) return;
    setMembers((prev) =>
      prev.map((m) => (m.userId === userId ? { ...m, status: "blocked" } : m)),
    );
    await blockMember(boardId, userId);
  }

  async function handleUnblockMember(userId: string) {
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    await unblockMember(boardId, userId);
  }

  async function handleGenerateInviteLink() {
    const token = await generateInviteLink(boardId);
    setInviteToken(token);
  }

  async function handleRevokeInviteLink() {
    if (!window.confirm("Revoke this invite link? It will stop working immediately.")) return;
    setInviteToken(null);
    await revokeInviteLink(boardId);
  }

  const detailCard = lists.flatMap((list) => list.cards).find((card) => card.id === detailCardId);
  const detailCardListId = lists.find((list) =>
    list.cards.some((card) => card.id === detailCardId),
  )?.id;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button
          type="button"
          onClick={() => setShowMembers(true)}
          className="text-sm underline"
        >
          Members ({members.filter((m) => m.status === "active").length + 1})
        </button>
      </div>

      <DndContext
        id={boardId}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
      <div className="flex gap-4 overflow-x-auto">
        <SortableContext items={lists.map((list) => list.id)} strategy={horizontalListSortingStrategy}>
          {lists.map((list) => (
            <SortableList
              key={list.id}
              list={list}
              boardLabels={boardLabels}
              showLabelText={showLabelText}
              onToggleLabelText={() => setShowLabelText((prev) => !prev)}
              isEditing={editingListId === list.id}
              onStartEdit={() => setEditingListId(list.id)}
              onCancelEdit={() => setEditingListId(null)}
              onRename={handleRenameList}
              onDelete={handleDeleteList}
              onAddCard={handleAddCard}
              editingCardTitleId={editingCardTitleId}
              onStartRenameCard={setEditingCardTitleId}
              onCancelRenameCard={() => setEditingCardTitleId(null)}
              onRenameCard={handleRenameCard}
              onOpenCardDetail={setDetailCardId}
              onDeleteCard={handleDeleteCard}
            />
          ))}
        </SortableContext>

        <form
          onSubmit={handleAddList}
          className="flex w-64 shrink-0 flex-col gap-2 rounded border border-dashed p-3"
        >
          <input
            name="title"
            placeholder="New list title"
            required
            className="rounded border px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded bg-foreground px-2 py-1.5 text-sm text-background"
          >
            Add list
          </button>
        </form>
      </div>

      {detailCard && detailCardListId && (
        <CardDetailModal
          card={detailCard}
          boardLabels={boardLabels}
          lists={lists}
          currentListId={detailCardListId}
          onClose={() => setDetailCardId(null)}
          onSave={handleSaveCardDetail}
          onDelete={handleDeleteCard}
          onToggleLabel={handleToggleCardLabel}
          onCreateLabel={handleCreateLabel}
          onDeleteLabel={handleDeleteLabel}
          onMove={handleMoveCard}
        />
      )}
      </DndContext>

      {showMembers && (
        <MembersModal
          isAdmin={isAdmin}
          ownerEmail={ownerEmail}
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
    </div>
  );
}

function SortableList({
  list,
  boardLabels,
  showLabelText,
  onToggleLabelText,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onRename,
  onDelete,
  onAddCard,
  editingCardTitleId,
  onStartRenameCard,
  onCancelRenameCard,
  onRenameCard,
  onOpenCardDetail,
  onDeleteCard,
}: {
  list: ListData;
  boardLabels: Label[];
  showLabelText: boolean;
  onToggleLabelText: () => void;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRename: (listId: string, title: string) => void;
  onDelete: (listId: string) => void;
  onAddCard: (listId: string, event: FormEvent<HTMLFormElement>) => void;
  editingCardTitleId: string | null;
  onStartRenameCard: (cardId: string) => void;
  onCancelRenameCard: () => void;
  onRenameCard: (cardId: string, title: string) => void;
  onOpenCardDetail: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: list.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="w-64 shrink-0 rounded border bg-background p-3">
      {isEditing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
            onRename(list.id, input.value);
          }}
          className="mb-2 flex gap-1"
        >
          <input
            name="title"
            defaultValue={list.title}
            autoFocus
            className="flex-1 rounded border px-2 py-1 text-sm font-medium"
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelEdit();
            }}
          />
          <button type="submit" className="text-sm underline">
            Save
          </button>
        </form>
      ) : (
        <div className="mb-2 flex items-center justify-between gap-1">
          <span {...attributes} {...listeners} className="flex-1 cursor-grab font-medium">
            {list.title}
          </span>
          <button
            type="button"
            onClick={onStartEdit}
            aria-label="Rename list"
            className="px-1 text-sm text-zinc-500 hover:text-foreground"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => onDelete(list.id)}
            aria-label="Delete list"
            className="px-1 text-sm text-zinc-500 hover:text-red-600"
          >
            ×
          </button>
        </div>
      )}

      <SortableContext items={list.cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <ul className="mb-3 flex min-h-2 flex-col gap-2">
          {list.cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              boardLabels={boardLabels}
              showLabelText={showLabelText}
              onToggleLabelText={onToggleLabelText}
              isEditingTitle={editingCardTitleId === card.id}
              onStartRename={() => onStartRenameCard(card.id)}
              onCancelRename={onCancelRenameCard}
              onRename={onRenameCard}
              onOpenDetail={() => onOpenCardDetail(card.id)}
              onDelete={onDeleteCard}
            />
          ))}
        </ul>
      </SortableContext>

      <form onSubmit={(event) => onAddCard(list.id, event)} className="flex flex-col gap-2">
        <input
          name="title"
          placeholder="New card title"
          required
          className="rounded border px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-foreground px-2 py-1.5 text-sm text-background"
        >
          Add card
        </button>
      </form>
    </div>
  );
}

function SortableCard({
  card,
  boardLabels,
  showLabelText,
  onToggleLabelText,
  isEditingTitle,
  onStartRename,
  onCancelRename,
  onRename,
  onOpenDetail,
  onDelete,
}: {
  card: CardItem;
  boardLabels: Label[];
  showLabelText: boolean;
  onToggleLabelText: () => void;
  isEditingTitle: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (cardId: string, title: string) => void;
  onOpenDetail: () => void;
  onDelete: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: card.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const cardLabels = boardLabels.filter((label) => card.labelIds.includes(label.id));

  if (isEditingTitle) {
    return (
      <li ref={setNodeRef} style={style} className="rounded border bg-zinc-50 p-2 text-sm dark:bg-zinc-900">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("title") as HTMLInputElement;
            onRename(card.id, input.value);
          }}
          className="flex gap-1"
        >
          <input
            name="title"
            defaultValue={card.title}
            autoFocus
            className="flex-1 rounded border px-2 py-1 text-sm"
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelRename();
            }}
          />
          <button type="submit" className="text-sm underline">
            Save
          </button>
        </form>
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group rounded bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
    >
      {cardLabels.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
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
                  ? "rounded px-2 py-0.5 text-xs font-medium text-white"
                  : "h-2 w-8 rounded-full"
              }
            >
              {showLabelText ? label.name : ""}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <span {...attributes} {...listeners} className="flex-1 cursor-grab">
          {card.title}
        </span>
        <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={onStartRename}
            aria-label="Rename card"
            className="px-1 text-zinc-500 hover:text-foreground"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => onDelete(card.id)}
            aria-label="Delete card"
            className="px-1 text-zinc-500 hover:text-red-600"
          >
            ×
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenDetail}
        aria-label="Open card details"
        className="mt-1 block w-full text-left text-xs text-zinc-500 hover:underline"
      >
        {card.description && <p className="line-clamp-2">{card.description}</p>}
        {card.dueDate && <p>Due {card.dueDate.toLocaleDateString()}</p>}
        {!card.description && !card.dueDate && <span className="text-zinc-400">Add details…</span>}
      </button>
    </li>
  );
}

function CardDetailModal({
  card,
  boardLabels,
  lists,
  currentListId,
  onClose,
  onSave,
  onDelete,
  onToggleLabel,
  onCreateLabel,
  onDeleteLabel,
  onMove,
}: {
  card: CardItem;
  boardLabels: Label[];
  lists: ListData[];
  currentListId: string;
  onClose: () => void;
  onSave: (cardId: string, updates: CardUpdates) => void;
  onDelete: (cardId: string) => void;
  onToggleLabel: (cardId: string, labelId: string, assigned: boolean) => void;
  onCreateLabel: (name: string, color: string) => void;
  onDeleteLabel: (labelId: string) => void;
  onMove: (cardId: string, targetListId: string) => void;
}) {
  const newLabelNameRef = useRef<HTMLInputElement>(null);
  const newLabelColorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded border bg-background p-4 shadow-lg"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const title = (form.elements.namedItem("title") as HTMLInputElement).value;
            const description = (form.elements.namedItem("description") as HTMLTextAreaElement).value;
            const dueDate = (form.elements.namedItem("dueDate") as HTMLInputElement).value;
            onSave(card.id, { title, description: description || null, dueDate: dueDate || null });
          }}
          className="flex flex-col gap-3"
        >
          <input
            name="title"
            defaultValue={card.title}
            autoFocus
            className="rounded border px-2 py-1.5 text-base font-medium"
          />
          <textarea
            name="description"
            defaultValue={card.description ?? ""}
            placeholder="Description"
            rows={4}
            className="rounded border px-2 py-1.5 text-sm"
          />
          <label className="flex flex-col gap-1 text-sm text-zinc-500">
            Due date
            <input
              name="dueDate"
              type="date"
              defaultValue={card.dueDate ? card.dueDate.toISOString().slice(0, 10) : ""}
              className="rounded border px-2 py-1.5 text-sm text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-zinc-500">
            List
            <select
              value={currentListId}
              onChange={(event) => onMove(card.id, event.target.value)}
              className="rounded border px-2 py-1.5 text-sm text-foreground"
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.title}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Labels</span>
            {boardLabels.map((label) => {
              const assigned = card.labelIds.includes(label.id);
              return (
                <div key={label.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleLabel(card.id, label.id, !assigned)}
                    style={
                      assigned
                        ? { backgroundColor: label.color, borderColor: label.color }
                        : { borderColor: label.color, color: label.color }
                    }
                    className={
                      assigned
                        ? "flex-1 rounded border-2 px-2 py-1 text-left text-sm text-white"
                        : "flex-1 rounded border-2 bg-transparent px-2 py-1 text-left text-sm"
                    }
                  >
                    {assigned ? `✓ ${label.name}` : label.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteLabel(label.id)}
                    aria-label={`Delete label ${label.name}`}
                    className="px-1 text-xs text-zinc-500 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <div className="flex gap-2">
              <input
                type="color"
                defaultValue="#2563eb"
                ref={newLabelColorRef}
                className="h-8 w-10 rounded border"
              />
              <input
                type="text"
                ref={newLabelNameRef}
                placeholder="New label"
                className="flex-1 rounded border px-2 py-1 text-sm"
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
                className="rounded bg-foreground px-2 py-1 text-xs text-background"
              >
                Add
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => onDelete(card.id)}
              className="text-sm text-red-600 hover:underline"
            >
              Delete card
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-foreground px-3 py-1.5 text-sm text-background"
              >
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function MembersModal({
  isAdmin,
  ownerEmail,
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
  ownerEmail: string;
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

  const statusLabel: Record<string, string> = {
    active: "Active",
    invited: "Invited",
    blocked: "Blocked",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded border bg-background p-4 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Members</h2>
          <button type="button" onClick={onClose} className="text-sm underline">
            Close
          </button>
        </div>

        <ul className="mb-3 flex flex-col gap-2">
          <li className="flex items-center justify-between rounded bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
            <span>{ownerEmail}</span>
            <span className="text-xs text-zinc-500">Admin</span>
          </li>
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-2 rounded bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
            >
              <span className="flex-1">{member.email}</span>
              <span className="text-xs text-zinc-500">{statusLabel[member.status]}</span>
              {isAdmin && (
                <div className="flex gap-2 text-xs">
                  {member.status === "active" && (
                    <>
                      <button
                        type="button"
                        onClick={() => onRemove(member.userId)}
                        className="underline"
                      >
                        Kick
                      </button>
                      <button
                        type="button"
                        onClick={() => onBlock(member.userId)}
                        className="text-red-600 underline"
                      >
                        Block
                      </button>
                    </>
                  )}
                  {member.status === "invited" && (
                    <>
                      <button
                        type="button"
                        onClick={() => onInvite(member.email)}
                        className="underline"
                      >
                        Re-invite
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(member.userId)}
                        className="text-red-600 underline"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {member.status === "blocked" && (
                    <button
                      type="button"
                      onClick={() => onUnblock(member.userId)}
                      className="underline"
                    >
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
            className="mb-3 flex gap-2"
          >
            <input
              type="email"
              ref={inviteEmailRef}
              placeholder="Invite by email"
              required
              className="flex-1 rounded border px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded bg-foreground px-3 py-1.5 text-sm text-background"
            >
              Invite
            </button>
          </form>
        )}

        {isAdmin && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="text-sm text-zinc-500">Invite link</span>
            {inviteLink ? (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={inviteLink}
                    onFocus={(event) => event.currentTarget.select()}
                    className="flex-1 rounded border px-2 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}
                    className="rounded border px-3 py-1.5 text-sm"
                  >
                    {linkCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onRevokeInviteLink}
                  className="self-start text-sm text-red-600 underline"
                >
                  Revoke link
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onGenerateInviteLink}
                className="self-start rounded border px-3 py-1.5 text-sm"
              >
                Create invite link
              </button>
            )}
            <p className="text-xs text-zinc-500">
              Anyone with this link can join the board — including people without an
              account yet. Sharing is up to you (chat, email, wherever).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
