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
import { useState, useTransition, type FormEvent } from "react";
import {
  createCard,
  createList,
  deleteCard,
  deleteList,
  reorderCards,
  reorderLists,
  updateCard,
  updateList,
} from "./actions";

type CardItem = { id: string; title: string; description: string | null; dueDate: Date | null };
type ListData = { id: string; title: string; cards: CardItem[] };
type CardUpdates = { title: string; description: string | null; dueDate: string | null };

// Hoisted so this object's identity is stable across renders — passing a
// fresh literal here every render defeats dnd-kit's sensor memoization and
// causes the drag to restart (re-fire onDragStart) on every state update.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };

export function Board({
  boardId,
  initialLists,
}: {
  boardId: string;
  initialLists: ListData[];
}) {
  const [lists, setLists] = useState(initialLists);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
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
              cards: [...list.cards, { id: card.id, title: card.title, description: null, dueDate: null }],
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

  async function handleSaveCard(cardId: string, updates: CardUpdates) {
    const trimmed = updates.title.trim();
    if (!trimmed) {
      setEditingCardId(null);
      return;
    }
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
    setEditingCardId(null);
    await updateCard(cardId, { ...updates, title: trimmed });
  }

  async function handleDeleteCard(cardId: string) {
    if (!window.confirm("Delete this card?")) return;
    setLists((prev) =>
      prev.map((list) => ({ ...list, cards: list.cards.filter((c) => c.id !== cardId) })),
    );
    await deleteCard(cardId);
  }

  return (
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
              isEditing={editingListId === list.id}
              onStartEdit={() => setEditingListId(list.id)}
              onCancelEdit={() => setEditingListId(null)}
              onRename={handleRenameList}
              onDelete={handleDeleteList}
              onAddCard={handleAddCard}
              editingCardId={editingCardId}
              onStartEditCard={setEditingCardId}
              onCancelEditCard={() => setEditingCardId(null)}
              onSaveCard={handleSaveCard}
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
    </DndContext>
  );
}

function SortableList({
  list,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onRename,
  onDelete,
  onAddCard,
  editingCardId,
  onStartEditCard,
  onCancelEditCard,
  onSaveCard,
  onDeleteCard,
}: {
  list: ListData;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRename: (listId: string, title: string) => void;
  onDelete: (listId: string) => void;
  onAddCard: (listId: string, event: FormEvent<HTMLFormElement>) => void;
  editingCardId: string | null;
  onStartEditCard: (cardId: string) => void;
  onCancelEditCard: () => void;
  onSaveCard: (cardId: string, updates: CardUpdates) => void;
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
              isEditing={editingCardId === card.id}
              onStartEdit={() => onStartEditCard(card.id)}
              onCancelEdit={onCancelEditCard}
              onSave={onSaveCard}
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
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  card: CardItem;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (cardId: string, updates: CardUpdates) => void;
  onDelete: (cardId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: card.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isEditing) {
    return (
      <li ref={setNodeRef} style={style} className="rounded border bg-zinc-50 p-2 text-sm dark:bg-zinc-900">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const title = (form.elements.namedItem("title") as HTMLInputElement).value;
            const description = (form.elements.namedItem("description") as HTMLTextAreaElement).value;
            const dueDate = (form.elements.namedItem("dueDate") as HTMLInputElement).value;
            onSave(card.id, { title, description: description || null, dueDate: dueDate || null });
          }}
          className="flex flex-col gap-2"
        >
          <input
            name="title"
            defaultValue={card.title}
            autoFocus
            className="rounded border px-2 py-1 text-sm"
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelEdit();
            }}
          />
          <textarea
            name="description"
            defaultValue={card.description ?? ""}
            placeholder="Description"
            rows={2}
            className="rounded border px-2 py-1 text-sm"
          />
          <input
            name="dueDate"
            type="date"
            defaultValue={card.dueDate ? card.dueDate.toISOString().slice(0, 10) : ""}
            className="rounded border px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-foreground px-2 py-1 text-xs text-background">
              Save
            </button>
            <button type="button" onClick={onCancelEdit} className="text-xs underline">
              Cancel
            </button>
          </div>
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
      <div className="flex items-start justify-between gap-2">
        <span {...attributes} {...listeners} className="flex-1 cursor-grab">
          {card.title}
        </span>
        <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={onStartEdit}
            aria-label="Edit card"
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
      {card.description && (
        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{card.description}</p>
      )}
      {card.dueDate && (
        <p className="mt-1 text-xs text-zinc-500">
          Due {card.dueDate.toLocaleDateString()}
        </p>
      )}
    </li>
  );
}
