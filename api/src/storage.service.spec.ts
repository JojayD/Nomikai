import { StorageService } from './storage.service';

const list = jest.fn();
const remove = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { from: () => ({ list, remove }) } }),
}));

beforeEach(() => {
  list.mockReset();
  remove.mockReset().mockResolvedValue({ error: null });
});

it('does not proceed with account deletion when listing photos fails', async () => {
  list.mockResolvedValue({
    data: null,
    error: new Error('storage unavailable'),
  });
  await expect(new StorageService().removeFolder('owner')).rejects.toThrow(
    'storage unavailable',
  );
});

it('removes every page before allowing the account to be deleted', async () => {
  const objects = Array.from({ length: 101 }, (_, i) => ({
    id: String(i),
    name: `${i}.jpg`,
  }));
  list.mockImplementation(() =>
    Promise.resolve({ data: objects.slice(0, 100), error: null }),
  );
  remove.mockImplementation((paths: string[]) => {
    for (const path of paths) {
      const index = objects.findIndex((f) => `owner/${f.name}` === path);
      if (index >= 0) objects.splice(index, 1);
    }
    return Promise.resolve({ error: null });
  });
  await new StorageService().removeFolder('owner');
  expect(objects).toEqual([]);
});

it('removes nested photo folders instead of repeatedly deleting the folder name', async () => {
  let remaining = true;
  let attempts = 0;
  list.mockImplementation((prefix: string) => {
    if (++attempts > 5) throw new Error('Folder cleanup did not make progress');
    return Promise.resolve({
      data: !remaining
        ? []
        : prefix === 'owner'
          ? [{ id: null, name: 'legacy' }]
          : [{ id: 'photo', name: 'photo.jpg' }],
      error: null,
    });
  });
  remove.mockImplementation((paths: string[]) => {
    if (paths.includes('owner/legacy/photo.jpg')) remaining = false;
    return Promise.resolve({ error: null });
  });
  await new StorageService().removeFolder('owner');
  expect(remaining).toBe(false);
});
