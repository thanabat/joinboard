import Link from "next/link";

export function BoardTabs({ boardId, active }: { boardId: string; active: "board" | "dashboard" }) {
  const tabClass = (tab: "board" | "dashboard") =>
    `cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition ${
      active === tab
        ? "bg-card text-foreground shadow-xs"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex items-center gap-1 rounded-md bg-muted p-1">
      <Link href={`/boards/${boardId}`} className={tabClass("board")}>
        Board
      </Link>
      <Link href={`/boards/${boardId}/dashboard`} className={tabClass("dashboard")}>
        Dashboard
      </Link>
    </div>
  );
}
