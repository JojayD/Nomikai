import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BarsController } from './bars.controller';
import { cleanMenu } from './menu-agent';
import { nearbyBars, searchBars } from './search';

// the real guard imports jose, which is ESM-only and jest cannot parse it
jest.mock('../auth.guard', () => ({ AuthGuard: class {} }));

describe('searchBars', () => {
  it.each([
    ['nomikai', 'Nomikai'],
    ['labyrinth', 'Labyrinth Bar & Kitchen'],
    ['sjbg', 'San Jose Bar and Grill'],
    ['bar none', 'Bar None'],
  ])('finds %s in the Bay Area snapshot', (query, name) => {
    expect(searchBars(query)[0]?.name).toBe(name);
    expect(searchBars(` ${query.toUpperCase()} `)[0]?.name).toBe(name);
  });
});

describe('nearbyBars', () => {
  it('lists bars within 500 m, nearest first', () => {
    const [nomikai] = searchBars('nomikai');
    const near = nearbyBars(nomikai.lat, nomikai.lon);
    expect(near[0].name).toBe('Nomikai');
    expect(near.length).toBeGreaterThan(1);
    expect(near.length).toBeLessThanOrEqual(10);
    // 0.005 degrees of latitude is about 550 m
    expect(nearbyBars(nomikai.lat + 0.005, nomikai.lon)).not.toContain(nomikai);
  });

  it('finds nothing far from the Bay Area', () => {
    expect(nearbyBars(0, 0)).toEqual([]);
  });
});

describe('POST /bars/nearby', () => {
  const controller = new BarsController(null as never);

  it.each([undefined, {}, { lat: '37.3', lng: -121.9 }, { lat: 91, lng: 0 }])(
    'rejects %j',
    (body) => {
      expect(() => controller.nearby(body as never)).toThrow(
        BadRequestException,
      );
    },
  );

  it('accepts numeric coordinates', () => {
    expect(controller.nearby({ lat: 37.3353, lng: -121.8898 })[0].name).toBe(
      'Nomikai',
    );
  });
});

describe('GET /bars/:type/:id/menu', () => {
  it('404s a bar that is not in the snapshot', async () => {
    await expect(
      new BarsController(null as never).menu('node', '1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('cleanMenu', () => {
  const item = {
    name: 'Spicy Margarita',
    is_alcoholic: true,
    category: 'cocktail',
  };
  const answer = (over: object) => ({
    has_menu: true,
    items: [item],
    source_urls: ['https://bar.example/menu'],
    ...over,
  });

  it('keeps a cited menu', () => {
    expect(cleanMenu(answer({}))).toEqual({
      items: [
        { name: 'Spicy Margarita', isAlcoholic: true, category: 'cocktail' },
      ],
      sourceUrls: ['https://bar.example/menu'],
    });
  });

  it.each([
    ['no menu', { has_menu: false, items: [] }],
    ['no items', { items: [] }],
    ['no source', { source_urls: [] }],
    [
      'a script link as the only source',
      { source_urls: ['javascript:alert(1)'] },
    ],
    ['items that are not a list', { items: 'Margarita' }],
  ])('returns null for %s', (_, over) => {
    expect(cleanMenu(answer(over))).toBeNull();
    expect(cleanMenu(null)).toBeNull();
  });

  it('drops bad items and caps the menu at 60', () => {
    const items = [
      { ...item, name: ' ' },
      { ...item, name: 'x'.repeat(121) },
      { ...item, category: 'food' },
      ...Array.from({ length: 70 }, (_, n) => ({
        ...item,
        name: `Drink  ${n}`,
      })),
    ];
    const menu = cleanMenu(answer({ items }))!;
    expect(menu.items).toHaveLength(60);
    expect(menu.items[0].name).toBe('Drink 0');
  });
});
