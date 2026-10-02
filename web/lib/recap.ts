export type Recap = {
  username: string | null;
  timezone: string | null;
  week_start: string | null;
  total_entries: number;
  unique_drinks: number;
  nights_out: number;
  most_reacted: { drink_name: string; reactions: number } | null;
};

export function weekLabel(recap: Recap) {
  if (!recap.week_start) return "";
  return new Date(recap.week_start).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: recap.timezone ?? undefined,
  });
}
