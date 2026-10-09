// Real API/Postgres regression checks; disposable local users only.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const base = process.env.API_URL ?? 'http://localhost:3101';
for (const url of [DATABASE_URL, SUPABASE_URL, base]) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Local targets only');
}
const db = postgres(DATABASE_URL, { prepare: false, connection: { application_name: 'audit-test' } });
const storage = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } }).storage.from('photos');
const photoPaths = [];
const users = [];
const failures = [];
let checks = 0;
function check(actual, expected, label) {
  checks++;
  try { assert.deepEqual(actual, expected, label); }
  catch (error) { failures.push(error.message); }
}
async function auth(path, body, method = 'POST') {
  const r = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: { apikey: SUPABASE_SECRET_KEY, authorization: `Bearer ${SUPABASE_SECRET_KEY}`, 'content-type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  assert.ok(r.ok, `Auth ${path}: ${r.status}`);
  return r.json();
}
async function api(user, path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
async function makeUser() {
  const email = `audit-${crypto.randomUUID()}@example.com`, password = crypto.randomUUID();
  const u = await auth('/admin/users', { email, password, email_confirm: true });
  users.push(u);
  u.token = (await auth('/token?grant_type=password', { email, password })).access_token;
  const r = await api(u, '/me', 'POST', { username: `a_${u.id.replaceAll('-', '').slice(0, 15)}`, timezone: 'UTC' });
  assert.equal(r.status, 201);
  return u;
}
const entry = (name) => ({ drink_id: null, custom_drink_name: name, night_out_id: null,
  logged_at: new Date().toISOString(), location: null, note: null, recommended: null });

try {
  const a = await makeUser(), b = await makeUser();
  check((await api(a, '/friendships', 'POST', { username: 42 })).status, 400, 'non-string username is client error');
  for (const path of ['/feed', `/entries?user_id=${a.id}`]) {
    for (const value of ['-1', '1.5', 'Infinity', 'wat', '']) {
      const r = await api(a, `${path}${path.includes('?') ? '&' : '?'}limit=${value}`);
      check(r.status, 400, `invalid limit ${JSON.stringify(value)} on ${path}`);
    }
  }
  for (const offset of ['-1', '1.5', 'Infinity']) {
    check((await api(a, `/entries?user_id=${a.id}&offset=${offset}`)).status, 400, `invalid offset ${offset}`);
  }
  check((await api(a, '/feed?before_logged_at=garbage')).status, 400, 'bad timestamp is client error');
  check((await api(a, '/night-outs?since=2026-99-99')).status, 400, 'out-of-range timestamp is client error');
  check((await api(a, '/me', 'PATCH', {})).status, 400, 'empty profile patch is client error');
  for (const timezone of ['Mars/Olympus', '', 42, null]) {
    check((await api(a, '/me', 'PATCH', { timezone })).status, 400, 'reject unsupported timezone');
  }
  check((await api(a, '/me')).body.timezone, 'UTC', 'invalid updates leave timezone intact');
  await api(a, '/me', 'PATCH', { timezone: 'UTC' });

  const lager = (await api(a, '/drinks')).body.find(d => d.normalized_name === 'lager');
  assert.ok(lager);
  for (const body of [{ ...entry(null), drink_id: lager.id }, entry('  LAGER  '), entry(String(lager.id))]) {
    assert.equal((await api(a, '/entries', 'POST', body)).status, 201);
  }
  for (const [path, select] of [
    [`/profiles/${a.id}/stats`, body => body.unique_drinks],
    ['/recap', body => body.unique_drinks],
    ['/leaderboard', body => body.find(r => r.id === a.id).unique_drinks],
  ]) {
    // The catalogue ID as text is a different drink; custom Lager is the same drink.
    check(select((await api(a, path)).body), 2, `normalized identity on ${path}`);
  }
  const numeric = (await api(a, `/entries?user_id=${a.id}`)).body.find(r => r.drink_name === String(lager.id));
  let directWriteCode;
  try {
    await db.begin(async tx => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: a.id, role: 'authenticated' })}, true)`;
      await tx`set local role authenticated`;
      await tx`update entries set photo_path = ${b.id + '/private.jpg'} where id = ${numeric.id}`;
      throw new Error('Direct photo path forgery allowed'); // Always roll back the probe.
    });
  } catch (error) { directWriteCode = error.code; }
  check(directWriteCode, '42501', 'direct clients cannot forge a photo path for privileged signing');
  await api(a, `/entries/${numeric.id}`, 'DELETE');
  check((await api(a, `/profiles/${a.id}/stats`)).body.unique_drinks, 1, 'curated and custom equivalent count once');
  check((await api(a, '/recap')).body.unique_drinks, 1, 'recap groups curated and custom names');
  check((await api(a, '/leaderboard')).body.find(r => r.id === a.id).unique_drinks, 1, 'leaderboard groups curated and custom names');
  check((await api(a, `/entries?user_id=${a.id}&limit=1&offset=1`)).body.length, 1, 'valid offset works');
  check((await api(a, '/feed?limit=999')).body.length, 2, 'large limit is capped without rejecting valid request');

  for (const role of ['anon', 'authenticated']) {
    const grants = await db`select table_name, column_name from information_schema.column_privileges
      where table_schema = 'public' and grantee = ${role}
      and table_name in ('profiles', 'drinks', 'entries', 'night_outs', 'friendships', 'blocks', 'reactions', 'saved_drinks')
      and privilege_type in ('INSERT', 'UPDATE')`;
    check(grants.length, 0, `${role} has no legacy table or column write grants`);
  }

  // Hold the same profile rows the block operation locks. The old API checks
  // blocks before waiting on its INSERT's FK lock, then inserts after commit.
  let pending;
  await db.begin(async tx => {
    await tx`select id from profiles where id in (${a.id}, ${b.id}) order by id for update`;
    await tx`insert into blocks (blocker_id, blocked_id) values (${a.id}, ${b.id})`;
    await tx`delete from friendships where requester_id in (${a.id}, ${b.id}) and addressee_id in (${a.id}, ${b.id})`;
    pending = api(b, '/friendships', 'POST', { addressee_id: a.id });
    // Synchronize on an actual blocked DB statement rather than hoping two requests overlap.
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await db`select pid from pg_stat_activity where datname = current_database()
        and wait_event_type = 'Lock' and (query like '%"friendships"%' or query like '%"profiles"%')`;
      if (rows.length) { waiting = true; break; }
      await delay(20);
    }
    assert.ok(waiting, 'friend request reached DB lock');
  });
  check((await pending).status, 403, 'request racing a block is rejected after commit');
  check((await api(a, `/friendships/with/${b.id}`)).body, null, 'block leaves no friendship');
  await api(a, `/blocks/${b.id}`, 'DELETE');
  await db`delete from friendships where requester_id in (${a.id}, ${b.id}) and addressee_id in (${a.id}, ${b.id})`;
  const race = await Promise.all([
    api(a, '/blocks', 'POST', { blocked_id: b.id }),
    api(b, '/friendships', 'POST', { addressee_id: a.id }),
  ]);
  check(race[0].status, 201, 'concurrent API block succeeds');
  check([201, 403].includes(race[1].status), true, 'concurrent request has a serial outcome');
  check((await api(a, `/friendships/with/${b.id}`)).body, null, 'concurrent API block leaves no friendship');
  check((await api(b, `/entries?user_id=${a.id}`)).status, 403, 'blocked profile history remains private');

  const photo = readFileSync(new URL('./fixtures/photo.jpg', import.meta.url));
  const names = [...Array.from({ length: 101 }, (_, i) => `${b.id}/${i}.jpg`), `${b.id}/legacy/nested.jpg`];
  photoPaths.push(...names);
  for (let i = 0; i < names.length; i += 10) {
    const uploads = await Promise.all(names.slice(i, i + 10).map(name => storage.upload(name, photo, { contentType: 'image/jpeg' })));
    assert.ok(uploads.every(r => !r.error), 'storage fixtures uploaded');
  }
  check((await api(b, '/me', 'DELETE')).status, 200, 'account deletion handles multiple pages and nested paths');
  const photos = await storage.list(b.id);
  assert.equal(photos.error, null);
  check(photos.data, [], 'account deletion removes every storage object');
} finally {
  if (photoPaths.length) {
    const { error } = await storage.remove(photoPaths);
    assert.equal(error, null, 'storage fixture cleanup');
  }
  for (const u of users) {
    if ((await db`select id from auth.users where id = ${u.id}`).length) await auth(`/admin/users/${u.id}`, null, 'DELETE');
  }
  await db.end();
}
console.log(`${checks - failures.length}/${checks} audit assertions passed`);
assert.equal(failures.length, 0, failures.join('\n'));
