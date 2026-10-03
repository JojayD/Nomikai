import { Test } from '@nestjs/testing';
import { createParamDecorator, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EntriesController } from './entries.controller';
import { DB, type Db } from './db';
import { StorageService } from './storage.service';

jest.mock('./auth.guard', () => ({
  AuthGuard: class {
    canActivate() {
      return true;
    }
  },
  UserId: createParamDecorator(() => 'owner'),
}));
jest.mock('./storage.service', () => ({ StorageService: class {} }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// In-memory boundary double. Delays are placed in Storage, after the DB change,
// to reproduce a remove finishing after a concurrent replacement has committed.
function fixture() {
  let row: { userId: string; photoPath: string | null } | null = {
    userId: 'owner',
    photoPath: 'owner/entry.jpg',
  };
  const objects = new Set(['owner/entry.jpg']);
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const result = Promise.resolve(row ? [{ ...row }] : []);
          return Object.assign(result, { for: () => result });
        },
      }),
    }),
    update: () => ({
      set: (values: { photoPath: string | null }) => ({
        where: () => {
          if (row) row = { ...row, ...values };
          const rows = row ? [{ ...row }] : [];
          return Object.assign(Promise.resolve(rows), {
            returning: () => Promise.resolve(rows),
          });
        },
      }),
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(db),
  };
  const storage = {
    upload: jest.fn((path: string) => {
      objects.add(path);
      return Promise.resolve();
    }),
    remove: jest.fn((paths: string[]) => {
      paths.forEach((p) => objects.delete(p));
      return Promise.resolve();
    }),
  };
  const controller = new EntriesController(
    db as unknown as Db,
    storage as unknown as StorageService,
  );
  return {
    db,
    storage,
    controller,
    objects,
    row: () => row,
    deleteRow: () => {
      row = null;
    },
  };
}
const jpeg = readFileSync(join(__dirname, '../test/fixtures/photo.jpg'));
const file = {
  buffer: jpeg,
  mimetype: 'image/jpeg',
  size: jpeg.length,
} as Express.Multer.File;

it('a delayed removal never deletes a replacement photo', async () => {
  const f = fixture();
  const started = deferred(),
    release = deferred();
  f.storage.remove.mockImplementationOnce(async (paths) => {
    started.resolve();
    await release.promise;
    paths.forEach((p) => f.objects.delete(p));
  });
  const removing = f.controller.clearPhoto('owner', 'entry');
  await started.promise;
  await f.controller.setPhoto('owner', 'entry', file);
  release.resolve();
  await removing;
  expect(f.objects.has(f.row()!.photoPath!)).toBe(true);
});

it('cleans up an upload if the entry was deleted while storage was uploading', async () => {
  const f = fixture();
  f.storage.upload.mockImplementationOnce((path) => {
    f.objects.add(path);
    f.deleteRow();
    return Promise.resolve();
  });
  await expect(f.controller.setPhoto('owner', 'entry', file)).rejects.toThrow(
    'No such entry',
  );
  expect([...f.objects]).toEqual(['owner/entry.jpg']);
});

describe('photo upload HTTP boundary', () => {
  let app: INestApplication<Server>;
  beforeEach(async () => {
    const f = fixture();
    const module = await Test.createTestingModule({
      controllers: [EntriesController],
      providers: [
        { provide: DB, useValue: f.db },
        { provide: StorageService, useValue: f.storage },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  it('rejects a missing file with 400', async () => {
    await request(app.getHttpServer()).post('/entries/entry/photo').expect(400);
  });
  it('rejects text masquerading as JPEG with 400', async () => {
    await request(app.getHttpServer())
      .post('/entries/entry/photo')
      .attach('file', Buffer.from('not an image'), {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
  });
  it('rejects files over 5 MiB before the handler', async () => {
    await request(app.getHttpServer())
      .post('/entries/entry/photo')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.jpg')
      .expect(413);
  });
  it('accepts JPEG content', async () => {
    await request(app.getHttpServer())
      .post('/entries/entry/photo')
      .attach('file', jpeg, 'photo.jpg')
      .expect(201);
  });
});
