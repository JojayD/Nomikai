import snapshot from './bars.json';

export type Bar = {
  name: string;
  city: string | null;
  address: string | null;
  aliases?: string[];
};

const bars: Bar[] = snapshot;

export function searchBars(query: string): Bar[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return bars
    .map((bar) => {
      const fields = [bar.name, ...(bar.aliases ?? []), bar.city ?? ''].map(
        (value) => value.toLowerCase(),
      );
      const rank = fields.some((value) => value === q)
        ? 0
        : fields.some((value) => value.startsWith(q))
          ? 1
          : fields.some((value) => value.includes(q))
            ? 2
            : 3;
      return { bar, rank };
    })
    .filter(({ rank }) => rank < 3)
    .sort((a, b) => a.rank - b.rank || a.bar.name.localeCompare(b.bar.name))
    .slice(0, 10)
    .map(({ bar }) => bar);
}
