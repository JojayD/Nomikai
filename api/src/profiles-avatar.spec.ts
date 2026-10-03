import { Test } from '@nestjs/testing';
import { createParamDecorator, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProfilesController } from './profiles.controller';
import { DB } from './db';
import { StorageService } from './storage.service';

jest.mock('./auth.guard', () => ({
  AuthGuard: class {
    canActivate() {
      return true;
    }
  },
  UserId: createParamDecorator(() => 'owner'),
  UserEmail: createParamDecorator(() => null),
}));
jest.mock('./storage.service', () => ({ StorageService: class {} }));

const jpeg = readFileSync(join(__dirname, '../test/fixtures/photo.jpg'));

// Only the update chain the avatar handler touches.
function fixture() {
  const set = jest.fn((values: { avatarUrl: string }) => ({
    where: () => Promise.resolve([{ avatarUrl: values.avatarUrl }]),
  }));
  const db = { update: () => ({ set }) };
  const storage = { upload: jest.fn(() => Promise.resolve()) };
  return { db, set, storage };
}

describe('avatar upload HTTP boundary', () => {
  let app: INestApplication<Server>;
  let f: ReturnType<typeof fixture>;
  beforeEach(async () => {
    f = fixture();
    const module = await Test.createTestingModule({
      controllers: [ProfilesController],
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
    await request(app.getHttpServer()).post('/me/avatar').expect(400);
    expect(f.storage.upload).not.toHaveBeenCalled();
  });

  it('rejects text masquerading as JPEG with 400', async () => {
    await request(app.getHttpServer())
      .post('/me/avatar')
      .attach('file', Buffer.from('not an image'), {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    expect(f.storage.upload).not.toHaveBeenCalled();
  });

  it('rejects files over 5 MiB before the handler', async () => {
    await request(app.getHttpServer())
      .post('/me/avatar')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), 'large.jpg')
      .expect(413);
    expect(f.storage.upload).not.toHaveBeenCalled();
  });

  it('stores a JPEG under the owner folder and records the path', async () => {
    const res = await request(app.getHttpServer())
      .post('/me/avatar')
      .attach('file', jpeg, 'photo.jpg')
      .expect(201);
    expect(res.body).toEqual({ avatar_url: 'owner/avatar.jpg' });
    expect(f.storage.upload).toHaveBeenCalledWith(
      'owner/avatar.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(f.set).toHaveBeenCalledWith({ avatarUrl: 'owner/avatar.jpg' });
  });
});
