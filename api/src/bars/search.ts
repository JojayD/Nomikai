import snapshot from './bars.json';

export type Bar = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  lat: number;
  lon: number;
  aliases?: string[];
};

const bars: Bar[] = snapshot;

export const barById = (id: string) => bars.find((bar) => bar.id === id);

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

const toRad = (degrees: number) => (degrees * Math.PI) / 180;

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

// ponytail: scans the whole snapshot per call; fine at ~1.6k bars, needs a
// spatial index if the snapshot grows past one metro area.
export function nearbyBars(lat: number, lng: number): Bar[] {
  return bars
    .map((bar) => ({ bar, meters: metersBetween(lat, lng, bar.lat, bar.lon) }))
    .filter(({ meters }) => meters <= 500)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 10)
    .map(({ bar }) => bar);
}
