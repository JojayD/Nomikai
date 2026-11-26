import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BarsController } from './bars.controller';
import { cleanMenu, lookupMenu } from './menu-agent';
import { nearbyBars, searchBars } from './search';

// the real guard imports jose, which is ESM-only and jest cannot parse it
jest.mock('../auth.guard', () => ({
  AuthGuard: class {},
  UserId: () => () => {},
}));

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class {
    messages = { create: mockCreate };
  },
}));

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

  it('covers 2nd Street in Long Beach', () => {
    expect(nearbyBars(33.7605, -118.1365).length).toBeGreaterThan(1);
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

  it('marks at most the two closest bars within 75 m for prefetch', () => {
    const found = controller.nearby({ lat: 37.3353, lng: -121.8898 });
    expect(found[0].prefetch).toBe(true);
    expect(found.filter((bar) => bar.prefetch).length).toBeLessThanOrEqual(2);
    expect(found.slice(2).some((bar) => bar.prefetch)).toBe(false);
  });
});

describe('GET /bars/:type/:id/menu', () => {
  it('404s a bar that is not in the snapshot', async () => {
    await expect(
      new BarsController(null as never).menu('me', 'node', '1'),
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

describe('lookupMenu', () => {
  const [bar] = searchBars('nomikai');
  const found = {
    has_menu: true,
    items: [{ name: 'Sake', is_alcoholic: true, category: 'wine' }],
    source_urls: ['https://bar.example/menu'],
  };
  const none = { has_menu: false, items: [], source_urls: [] };
  const submit = (input: object) => ({
    type: 'tool_use',
    id: 'toolu_1',
    name: 'submit_menu',
    input,
  });
  const searchError = (error_code: string) => ({
    type: 'web_search_tool_result',
    content: { type: 'web_search_tool_result_error', error_code },
  });
  const reply = (stop_reason: string, ...content: object[]) =>
    mockCreate.mockResolvedValueOnce({ stop_reason, content });

  beforeEach(() => mockCreate.mockReset());

  it('returns the menu, resuming a paused search', async () => {
    reply('pause_turn');
    reply('tool_use', submit(found));
    expect((await lookupMenu(bar))?.items[0].name).toBe('Sake');
  });

  it('returns null only when the model looked and found none', async () => {
    reply('tool_use', searchError('max_uses_exceeded'), submit(none));
    expect(await lookupMenu(bar)).toBeNull();
  });

  it('keeps a menu found despite one failed search', async () => {
    reply('tool_use', searchError('unavailable'), submit(found));
    expect(await lookupMenu(bar)).not.toBeNull();
  });

  it('believes "no menu" once a later search worked', async () => {
    const searched = { type: 'web_search_tool_result', content: [] };
    reply('tool_use', searchError('unavailable'), searched, submit(none));
    expect(await lookupMenu(bar)).toBeNull();
  });

  it.each([
    ['a failed search', [searchError('too_many_requests'), submit(none)]],
    ['an uncited menu', [submit({ ...found, source_urls: [] })]],
  ])('asks once for a correction after %s', async (_, content) => {
    reply('tool_use', ...content);
    reply('tool_use', submit(found));
    expect(await lookupMenu(bar)).not.toBeNull();
    const [[{ messages }]] = mockCreate.mock.calls.slice(-1) as [
      [{ messages: { content: object[] }[] }],
    ];
    expect(messages.at(-1)?.content).toMatchObject([
      { type: 'tool_result', tool_use_id: 'toolu_1', is_error: true },
    ]);
  });

  it('throws when the search never worked, even if it stops searching', async () => {
    reply('pause_turn', searchError('too_many_requests'));
    reply('tool_use', submit(none));
    reply('tool_use', submit(none));
    await expect(lookupMenu(bar)).rejects.toThrow('Web search failed');
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('throws when the menu is still uncited', async () => {
    reply('tool_use', submit({ ...found, source_urls: [] }));
    reply('tool_use', submit({ ...found, source_urls: [] }));
    await expect(lookupMenu(bar)).rejects.toThrow('Unusable');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it.each(['max_tokens', 'refusal'])(
    'throws on a submit_menu cut off by %s',
    async (stopReason) => {
      reply(stopReason, submit(none));
      await expect(lookupMenu(bar)).rejects.toThrow(stopReason);
    },
  );
});
