"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createRetroItem, deleteRetroItem } from "../../actions";

type RetroColumn = "went_well" | "to_improve" | "action_items";
type RetroItem = { id: string; column: RetroColumn; content: string; authorName: string };

const COLUMNS: { key: RetroColumn; label: string; color: string }[] = [
  { key: "went_well", label: "Went well", color: "#16a34a" },
  { key: "to_improve", label: "To improve", color: "#dc2626" },
  { key: "action_items", label: "Action items", color: "#2563eb" },
];

export function RetroBoard({ sprintId, initialItems }: { sprintId: string; initialItems: RetroItem[] }) {
  const [items, setItems] = useState(initialItems);

  async function handleAdd(column: RetroColumn, content: string) {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      const { item } = await createRetroItem(sprintId, column, trimmed);
      setItems((prev) => [...prev, { id: item.id, column, content: item.content, authorName: item.authorName }]);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't add note");
    }
  }

  async function handleDelete(itemId: string) {
    const previous = items;
    setItems((prev) => prev.filter((item) => item.id !== itemId));
    try {
      await deleteRetroItem(itemId);
    } catch (error) {
      setItems(previous);
      window.alert(error instanceof Error ? error.message : "Couldn't remove note");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {COLUMNS.map((column) => {
        const columnItems = items.filter((item) => item.column === column.key);
        return (
          <div key={column.key} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
            <span
              className="w-fit rounded px-2 py-0.5 text-xs font-semibold"
              style={{ color: column.color, backgroundColor: `${column.color}1a` }}
            >
              {column.label}
            </span>
            <ul className="flex flex-col gap-1.5">
              {columnItems.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                columnItems.map((item) => (
                  <li
                    key={item.id}
                    className="group/retro flex items-start justify-between gap-2 rounded-md bg-muted px-2.5 py-2 text-sm"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span>{item.content}</span>
                      <span className="text-xs text-muted-foreground">{item.authorName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      aria-label="Remove note"
                      className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover/retro:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))
              )}
            </ul>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const input = form.elements.namedItem("content") as HTMLInputElement;
                handleAdd(column.key, input.value);
                input.value = "";
              }}
              className="flex gap-1.5"
            >
              <input
                name="content"
                placeholder="Add a note…"
                className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
              />
              <button
                type="submit"
                aria-label="Add note"
                className="shrink-0 cursor-pointer rounded-md bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" />
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
