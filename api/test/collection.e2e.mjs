// Local-only real Auth/API/Postgres acceptance checks. Run with the API running:
// node --env-file=/tmp/nomikai-collection-api.env test/collection.e2e.mjs
import assert from 'node:assert/strict';
import postgres from 'postgres';

const { DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
const base = process.env.API_URL ?? 'http://localhost:3101';
for (const url of [DATABASE_URL, SUPABASE_URL, base]) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Local targets only');
}
const db = postgres(DATABASE_URL, { prepare: false });
const users = [];
let checks = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks++;
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
    headers: { ...(user && { authorization: `Bearer ${user.token}` }), 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json() };
}
async function makeUser() {
  const email = `collection-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();
  const u = await auth('/admin/users', { email, password, email_confirm: true });
  users.push(u);
  u.token = (await auth('/token?grant_type=password', { email, password })).access_token;
  check((await api(u, '/me', 'POST', { username: `c_${u.id.replaceAll('-', '').slice(0, 15)}`, timezone: 'UTC' })).status, 201, 'onboard');
  return u;
}
const entryBody = (name, recommended = null, logged_at = '2026-10-01T12:00:00Z') => ({
  drink_id: null, custom_drink_name: name, night_out_id: null, location: null,
  note: null, recommended, logged_at,
});

try {
  const a = await makeUser(), b = await makeUser();
  for (const path of ['/collection/saved', '/collection/passport']) {
    check((await api(null, path)).status, 401, 'auth required');
    const r = await api(a, path);
    check(r.status, 200, 'collection route exists');
    check(r.body, [], 'new collection empty');
  }
  for (const name of [null, 42, {}, [], '', ' \t\n ', 'x'.repeat(121), 'Tea\0lime']) {
    check((await api(a, '/collection/saved', 'PUT', { name })).status, 400, 'invalid name');
  }
  check((await api(a, '/collection/saved', 'PUT', {})).status, 400, 'missing name');
  const boundary = await api(a, '/collection/saved', 'PUT', { name: '🍵'.repeat(120) });
  check(boundary.status, 200, '120 Unicode characters accepted');
  await api(a, `/collection/saved/${boundary.body.id}`, 'DELETE');
  const save = await api(a, '/collection/saved', 'PUT', { name: '  Virgin   Mojito  ', user_id: b.id });
  check(save.status, 200, 'save succeeds');
  const id = save.body.id;
  const simultaneous = await Promise.all(Array.from({ length: 5 }, () => api(a, '/collection/saved', 'PUT', { name: 'virgin MOJITO' })));
  check(simultaneous.every(r => r.status === 200 && r.body.id === id), true, 'concurrent retries same ID');
  let saved = (await api(a, '/collection/saved')).body;
  check(saved.length, 1, 'deduplicated');
  check(saved[0].name, 'Virgin Mojito', 'display name preserved');
  check(saved[0].tried, false, 'untried initially');
  check((await api(b, `/collection/saved?user_id=${a.id}`)).body, [], 'cannot read foreign saves');
  check((await api(b, `/collection/saved/${id}`, 'DELETE')).status, 200, 'foreign deletion neutral');
  check((await api(a, '/collection/saved')).body.length, 1, 'foreign delete has no effect');
  check((await api(a, '/collection/saved/not-a-uuid', 'DELETE')).status, 400, 'malformed ID');

  const drinks = (await api(a, '/drinks')).body;
  const lager = drinks.find(d => d.normalized_name === 'lager');
  assert.ok(lager);
  const first = await api(a, '/entries', 'POST', { ...entryBody(null, true), drink_id: lager.id });
  check(first.status, 201, 'curated log');
  const second = await api(a, '/entries', 'POST', entryBody('  LAGER ', false, '2026-10-02T12:00:00Z'));
  check(second.status, 201, 'custom equivalent log');
  const virgin = await api(a, '/entries', 'POST', entryBody('Virgin Mojito', true));
  check(virgin.status, 201, 'nonalcoholic log');
  const passport = () => api(a, '/collection/passport').then(r => r.body);
  let rows = await passport();
  check(rows.length, 2, 'unique normalized drinks');
  check(rows[0].normalized_name, 'lager', 'newest drink first');
  check(rows[0].times_logged, 2, 'curated/custom grouped');
  check(rows[0].recommended, false, 'latest recommendation wins');
  check(new Date(rows[0].first_logged_at).toISOString(), '2026-10-01T12:00:00.000Z', 'first date');
  check(new Date(rows[0].last_logged_at).toISOString(), '2026-10-02T12:00:00.000Z', 'last date');
  check((await api(b, `/collection/passport?user_id=${a.id}`)).body, [], 'passport private');
  check((await api(a, '/collection/saved')).body[0].tried, true, 'logging marks tried');
  check((await api(a, `/entries/${virgin.body.id}`, 'PATCH', entryBody('Tea'))).status, 200, 'edit log');
  check((await api(a, '/collection/saved')).body[0].tried, false, 'editing recomputes tried');
  check((await passport()).some(r => r.normalized_name === 'virgin mojito'), false, 'old name removed');
  await api(a, `/entries/${second.body.id}`, 'DELETE');
  rows = await passport();
  check(rows.find(r => r.normalized_name === 'lager').times_logged, 1, 'delete recomputes count');
  check(rows.find(r => r.normalized_name === 'lager').recommended, true, 'delete restores surviving recommendation');
  // Equal timestamps must still select the newest created log deterministically.
  const tie = await api(a, '/entries', 'POST', entryBody('lager', null));
  check((await passport()).find(r => r.normalized_name === 'lager').recommended, null, 'latest neutral rating stays neutral');
  await api(a, `/entries/${tie.body.id}`, 'DELETE');
  await api(a, `/entries/${first.body.id}`, 'DELETE');
  check((await passport()).some(r => r.normalized_name === 'lager'), false, 'last deletion removes stamp');
  for (let i = 0; i < 2; i++) check((await api(a, `/collection/saved/${id}`, 'DELETE')).status, 200, 'idempotent remove');
  check((await api(a, '/collection/saved')).body, [], 'removed');

  const concurrentFirst = await Promise.all(Array.from({ length: 5 }, () => api(a, '/collection/saved', 'PUT', { name: 'First save' })));
  check(new Set(concurrentFirst.map(r => r.body.id)).size, 1, 'concurrent first inserts deduplicate');
  check(concurrentFirst.every(r => r.status === 200), true, 'all concurrent first inserts succeed');
  const retried = await api(a, '/collection/saved', 'PUT', { name: 'FIRST SAVE' });
  check(retried.body.created_at, concurrentFirst[0].body.created_at, 'retry preserves original saved time');
  for (const name of ['Tea\uFEFFlime', '\tTea\t']) {
    const log = await api(a, '/entries', 'POST', entryBody(name));
    check(log.status, 201, 'legacy whitespace log');
    const s = await api(a, '/collection/saved', 'PUT', { name });
    check(s.status, 200, 'save whitespace name');
    check((await api(a, '/collection/saved')).body.find(r => r.id === s.body.id).tried, true, 'same drink stays tried with legacy whitespace');
    check((await passport()).some(r => r.normalized_name === s.body.normalized_name), true, 'passport and saved identity agree');
  }
  await api(b, '/collection/saved', 'PUT', { name: 'Private B drink' });
  check((await db`select count(*)::int as n from saved_drinks`).at(0).n >= 4, true, 'real rows exist for access-denial checks');
  await db`insert into entries (id, user_id, custom_drink_name, normalized_drink_name, logged_at, created_at, recommended)
    values ('00000000-0000-4000-8000-000000000001', ${a.id}, 'Tie drink', '', '2026-10-01', '2026-10-01', false),
           ('00000000-0000-4000-8000-000000000002', ${a.id}, 'Tie drink', '', '2026-10-01', '2026-10-01', true)`;
  check((await passport()).find(r => r.normalized_name === 'tie drink').recommended, true, 'UUID breaks exact timestamp ties');
  await api(a, '/entries', 'POST', entryBody('   '));
  check((await passport()).some(r => !r.normalized_name.trim()), false, 'historical blank names omitted');

  const [{ relrowsecurity }] = await db`select relrowsecurity from pg_class where oid = 'public.saved_drinks'::regclass`;
  check(relrowsecurity, true, 'RLS enabled');
  const policies = await db`select * from pg_policies where schemaname = 'public' and tablename = 'saved_drinks'`;
  check(policies.length, 0, 'API-only table has no client policies');
  for (const role of ['anon', 'authenticated']) {
    try {
      await db.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        check((await tx`select * from public.saved_drinks`).length, 0, `${role} cannot read`);
      });
    } catch (e) { check(e.code, '42501', `${role} has no table grant`); }
    await assert.rejects(db.begin(async tx => {
      await tx.unsafe(`set local role ${role}`);
      await tx`insert into saved_drinks (user_id,name) values (${a.id}, 'Forbidden')`;
    }), {code: '42501'}, `${role} cannot insert`);
    checks++;
    for (const operation of ['update', 'delete']) {
      try {
        await db.begin(async tx => {
          await tx.unsafe(`set local role ${role}`);
          const rows = operation === 'update'
            ? await tx`update saved_drinks set name = 'Forbidden' returning id`
            : await tx`delete from saved_drinks returning id`;
          check(rows.length, 0, `${role} cannot ${operation}`);
        });
      } catch (e) { check(e.code, '42501', `${role} has no ${operation} grant`); }
    }
  }
  await api(a, '/collection/saved', 'PUT', { name: 'Tea' });
  await auth(`/admin/users/${a.id}`, null, 'DELETE');
  check((await db`select * from public.saved_drinks where user_id = ${a.id}`).length, 0, 'account cascade');
  console.log(`${checks} collection assertions passed`);
} finally {
  for (const u of users) {
    const present = await db`select id from auth.users where id = ${u.id}`;
    if (present.length) await auth(`/admin/users/${u.id}`, null, 'DELETE');
  }
  await db.end();
}
