import { searchBars } from './search';

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
