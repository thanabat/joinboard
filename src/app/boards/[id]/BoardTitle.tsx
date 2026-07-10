"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import { updateBoard } from "./actions";

export function BoardTitle({
  boardId,
  initialName,
  initialKey,
  isAdmin,
}: {
  boardId: string;
  initialName: string;
  initialKey: string;
  isAdmin: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [key, setKey] = useState(initialKey);
  const [showEdit, setShowEdit] = useState(false);

  async function handleSave(nextName: string, nextKey: string) {
    try {
      const result = await updateBoard(boardId, nextName, nextKey);
      setName(result.name);
      setKey(result.key);
      setShowEdit(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't update board");
    }
  }

  return (
    <div className="group/title flex items-center gap-2">
      <h1 className="text-lg font-semibold tracking-tight">{name}</h1>
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-muted-foreground">
        {key}
      </span>
      {isAdmin && (
        <button
          type="button"
          onClick={() => setShowEdit(true)}
          aria-label="Edit board"
          className="cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/title:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {showEdit &&
        createPortal(
          <EditBoardModal
            name={name}
            boardKey={key}
            onClose={() => setShowEdit(false)}
            onSave={handleSave}
          />,
          document.body,
        )}
    </div>
  );
}

function EditBoardModal({
  name,
  boardKey,
  onClose,
  onSave,
}: {
  name: string;
  boardKey: string;
  onClose: () => void;
  onSave: (name: string, key: string) => void;
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
            const nextName = (form.elements.namedItem("name") as HTMLInputElement).value;
            const nextKey = (form.elements.namedItem("key") as HTMLInputElement).value;
            onSave(nextName, nextKey);
          }}
          className="flex flex-col gap-4"
        >
          <h2 className="text-base font-semibold tracking-tight">Edit board</h2>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            Board name
            <input
              name="name"
              defaultValue={name}
              autoFocus
              required
              className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            Board prefix
            <input
              name="key"
              defaultValue={boardKey}
              required
              maxLength={10}
              className="w-32 rounded-md border bg-background px-2.5 py-2 font-mono text-sm uppercase text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
            <span className="text-xs font-normal text-muted-foreground/80">
              Shown on cards as &quot;{boardKey || "PREFIX"}-42&quot;. Changing it won&apos;t renumber existing
              cards, but old references to the current prefix will no longer match.
            </span>
          </label>

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
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
