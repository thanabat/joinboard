"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteBoard, unarchiveBoard } from "./[id]/actions";

type ArchivedBoard = {
  id: string;
  name: string;
  key: string;
  archivedAt: Date;
  listCount: number;
  cardCount: number;
};

export function ArchivedBoardsSection({ boards: initialBoards }: { boards: ArchivedBoard[] }) {
  const [boards, setBoards] = useState(initialBoards);
  const [deletingBoard, setDeletingBoard] = useState<ArchivedBoard | null>(null);
  const router = useRouter();

  async function handleRestore(board: ArchivedBoard) {
    try {
      await unarchiveBoard(board.id);
      setBoards((prev) => prev.filter((b) => b.id !== board.id));
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't restore board");
    }
  }

  async function handleDeleteEmpty(board: ArchivedBoard) {
    if (!window.confirm(`Permanently delete "${board.name}"? This can't be undone.`)) return;
    try {
      await deleteBoard(board.id, board.name);
      setBoards((prev) => prev.filter((b) => b.id !== board.id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't delete board");
    }
  }

  async function handleConfirmDelete(board: ArchivedBoard, typedName: string) {
    try {
      await deleteBoard(board.id, typedName);
      setBoards((prev) => prev.filter((b) => b.id !== board.id));
      setDeletingBoard(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't delete board");
    }
  }

  if (boards.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-muted-foreground">Archived boards</h2>
      <ul className="flex flex-col gap-2">
        {boards.map((board) => (
          <li
            key={board.id}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-muted-foreground">{board.name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                {board.key}
              </span>
              <span className="text-xs text-muted-foreground">
                Archived {board.archivedAt.toLocaleDateString("en-US")}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleRestore(board)}
                className="cursor-pointer text-sm font-medium text-primary hover:underline"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() =>
                  board.listCount === 0 && board.cardCount === 0
                    ? handleDeleteEmpty(board)
                    : setDeletingBoard(board)
                }
                className="cursor-pointer text-sm font-medium text-destructive hover:underline"
              >
                Delete permanently
              </button>
            </div>
          </li>
        ))}
      </ul>

      {deletingBoard && (
        <DeleteBoardModal
          board={deletingBoard}
          onClose={() => setDeletingBoard(null)}
          onConfirm={(typedName) => handleConfirmDelete(deletingBoard, typedName)}
        />
      )}
    </section>
  );
}

function DeleteBoardModal({
  board,
  onClose,
  onConfirm,
}: {
  board: ArchivedBoard;
  onClose: () => void;
  onConfirm: (typedName: string) => void;
}) {
  const [typedName, setTypedName] = useState("");
  const matches = typedName === board.name;

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
            if (matches) onConfirm(typedName);
          }}
          className="flex flex-col gap-4"
        >
          <h2 className="text-base font-semibold tracking-tight text-destructive">Delete board permanently</h2>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <span className="font-medium text-foreground">{board.name}</span>,
            including {board.listCount} list{board.listCount === 1 ? "" : "s"} and {board.cardCount} card
            {board.cardCount === 1 ? "" : "s"}. This can&apos;t be undone.
          </p>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            Type <span className="font-mono text-foreground">{board.name}</span> to confirm
            <input
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              autoFocus
              className="rounded-md border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition focus:border-destructive focus:ring-2 focus:ring-destructive/30"
            />
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
              disabled={!matches}
              className="cursor-pointer rounded-md bg-destructive px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-destructive-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete permanently
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
