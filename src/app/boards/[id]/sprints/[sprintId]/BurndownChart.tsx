import { TrendingDown } from "lucide-react";

type BurndownCard = { storyPoints: number | null; completedAt: Date | null };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function BurndownChart({
  startDate,
  endDate,
  cards,
}: {
  startDate: Date;
  endDate: Date;
  cards: BurndownCard[];
}) {
  const totalPoints = cards.reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY));
  // A completed sprint's "actual" line runs all the way to its end date;
  // an active sprint's stops at today, since later days haven't happened yet.
  const cutoff = Math.min(new Date().getTime(), endDate.getTime());

  const points = Array.from({ length: totalDays + 1 }, (_, day) => {
    const date = new Date(startDate.getTime() + day * MS_PER_DAY);
    const ideal = totalPoints * (1 - day / totalDays);
    if (date.getTime() > cutoff) return { day, date, ideal, actual: null as number | null };
    const completedPoints = cards
      .filter((card) => card.completedAt && card.completedAt.getTime() <= date.getTime())
      .reduce((sum, card) => sum + (card.storyPoints ?? 0), 0);
    return { day, date, ideal, actual: totalPoints - completedPoints };
  });

  const width = 640;
  const height = 240;
  const padding = { top: 12, right: 12, bottom: 28, left: 32 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (day: number) => padding.left + (day / totalDays) * plotWidth;
  const y = (value: number) => padding.top + (1 - value / totalPoints) * plotHeight;

  const idealPath = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.day)},${y(point.ideal)}`).join(" ");
  const actualPoints = points.filter(
    (point): point is typeof point & { actual: number } => point.actual !== null,
  );
  const actualPath = actualPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.day)},${y(point.actual)}`)
    .join(" ");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <TrendingDown className="h-3.5 w-3.5" />
        Burndown
      </h2>
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        {totalPoints === 0 ? (
          <p className="text-sm text-muted-foreground">
            No estimated cards in this sprint yet — add story points to see a burndown.
          </p>
        ) : (
          <>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
              {[0, 0.5, 1].map((fraction) => (
                <line
                  key={fraction}
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y(totalPoints * fraction)}
                  y2={y(totalPoints * fraction)}
                  className="stroke-border"
                  strokeWidth={1}
                />
              ))}
              {[0, 0.5, 1].map((fraction) => (
                <text
                  key={fraction}
                  x={padding.left - 6}
                  y={y(totalPoints * fraction)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {Math.round(totalPoints * fraction)}
                </text>
              ))}
              <path d={idealPath} fill="none" className="stroke-muted-foreground" strokeDasharray="4 3" strokeWidth={1.5} />
              <path d={actualPath} fill="none" className="stroke-primary" strokeWidth={2} />
              {actualPoints.map((point) => (
                <circle key={point.day} cx={x(point.day)} cy={y(point.actual)} r={2.5} className="fill-primary" />
              ))}
              <text x={padding.left} y={height - 8} textAnchor="start" className="fill-muted-foreground text-[10px]">
                {points[0].date.toLocaleDateString("en-US")}
              </text>
              <text
                x={width - padding.right}
                y={height - 8}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {points[points.length - 1].date.toLocaleDateString("en-US")}
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
        )}
      </div>
    </section>
  );
}
