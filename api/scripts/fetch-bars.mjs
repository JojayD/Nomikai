// Refresh: node api/scripts/fetch-bars.mjs
// Offline: node api/scripts/fetch-bars.mjs saved-overpass.json [more.json ...]
// Data: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright
// The generated snapshot is available under ODbL 1.0.
// Restaurants are kept only when named like a bar (Labyrinth and SJBG are
// tagged as restaurants in OSM). Missing city/address tags stay null.
import { readFile, writeFile } from 'node:fs/promises';

// San Francisco Bay Area, then Long Beach
const bboxes = ['36.9,-122.65,38.35,-121.55', '33.74,-118.21,33.79,-118.11'];
const words =
  'bar|pub|tavern|saloon|lounge|taproom|brewery|brewing|beer garden|cantina|izakaya';
const barName = new RegExp(`\\b(${words})\\b`, 'i');
const query = `[out:json][timeout:90];(${bboxes
  .map(
    (bbox) => `
  nwr["amenity"~"^(bar|pub|nightclub|biergarten)$"](${bbox});
  nwr["amenity"="restaurant"]["name"~"${words}",i](${bbox});`,
  )
  .join('')}
);out center tags;`;

const files = process.argv.slice(2);
let sources;
if (files.length) {
  sources = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
  );
} else {
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': 'Nomikai-bar-snapshot/1.0' },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Overpass: ${response.status}`);
  sources = [await response.json()];
}

const bars = new Map();
for (const source of sources) {
  // Overpass can return HTTP 200 with a timeout and incomplete elements.
  if (source.remark || !Array.isArray(source.elements)) {
    throw new Error(source.remark || 'Invalid Overpass response');
  }
  for (const { type, id, lat, lon, center, tags = {} } of source.elements) {
    const name = tags.name?.trim();
    if (!name) continue;
    if (
      !['bar', 'pub', 'nightclub', 'biergarten'].includes(tags.amenity) &&
      !(tags.amenity === 'restaurant' && barName.test(name))
    )
      continue;
    const city = tags['addr:city']?.trim() || null;
    const address =
      [tags['addr:housenumber'], tags['addr:street']]
        .filter(Boolean)
        .join(' ') || null;
    const aliases =
      name.toLowerCase() === 'san jose bar and grill' ? ['SJBG'] : [];
    // nodes carry lat/lon; ways and relations get a centre from `out center`
    const bar = {
      id: `${type}/${id}`,
      name,
      city,
      address,
      lat: lat ?? center?.lat,
      lon: lon ?? center?.lon,
      ...(aliases.length ? { aliases } : {}),
    };
    if (bar.lat == null || bar.lon == null) continue;
    const key = JSON.stringify([name, city, address]).toLowerCase();
    bars.set(key, bar);
  }
}

const snapshot = [...bars.values()].sort(
  (a, b) =>
    a.name.localeCompare(b.name, 'en') ||
    (a.city || '').localeCompare(b.city || '', 'en') ||
    (a.address || '').localeCompare(b.address || '', 'en'),
);
if (!snapshot.length) throw new Error('Refusing to write an empty snapshot');
await writeFile(
  new URL('../src/bars/bars.json', import.meta.url),
  // one bar per line: short file, readable diffs
  `[\n${snapshot.map((bar) => JSON.stringify(bar)).join(',\n')}\n]\n`,
);
console.log(
  `Wrote ${snapshot.length} bars (OSM: ${sources.map((s) => s.osm3s?.timestamp_osm_base).join(', ')})`,
);
