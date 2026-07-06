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
import { createCard, createList, reorderCards, reorderLists } from "./actions";

type CardItem = { id: string; title: string };
type ListData = { id: string; title: string; cards: CardItem[] };

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
          ? { ...list, cards: [...list.cards, { id: card.id, title: card.title }] }
          : list,
      ),
    );
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
            <SortableList key={list.id} list={list} onAddCard={handleAddCard} />
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
  onAddCard,
}: {
  list: ListData;
  onAddCard: (listId: string, event: FormEvent<HTMLFormElement>) => void;
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
      <h2 {...attributes} {...listeners} className="mb-2 cursor-grab font-medium">
        {list.title}
      </h2>
      <SortableContext items={list.cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <ul className="mb-3 flex min-h-2 flex-col gap-2">
          {list.cards.map((card) => (
            <SortableCard key={card.id} card={card} />
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

function SortableCard({ card }: { card: CardItem }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: card.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab rounded bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
    >
      {card.title}
    </li>
  );
}
