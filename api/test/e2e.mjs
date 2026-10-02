// End-to-end check against a real Supabase project: creates two throwaway
// users, drives every endpoint through the running API, and deletes the users
// (cascading their rows) at the end.
//
//   node test/e2e.mjs            # expects `npm run start:dev` on $API
import 'dotenv/config';

const API = process.env.API ?? 'http://localhost:3001';
const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function admin(path, init) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Creates a confirmed user and returns { id, token, email, password }. */
async function makeUser(tag) {
  const email = `e2e-${tag}-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();
  const user = await admin('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const session = await admin('/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return { id: user.id, token: session.access_token, email };
}

/** One API call. Returns { status, body }. */
async function api(user, method, path, body) {
  const init = { method, headers: {} };
  if (user) init.headers.authorization = `Bearer ${user.token}`;
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const a = await makeUser('a');
const b = await makeUser('b');
const nameA = `e2e_${a.id.replace(/-/g, '').slice(0, 12)}`;
const nameB = `e2e_${b.id.replace(/-/g, '').slice(0, 12)}`;
let entryId;

try {
  console.log('\n— auth —');
  check('no token → 401', (await api(null, 'GET', '/me')).status === 401);
  check(
    'garbage token → 401',
    (await api({ token: 'nope.nope.nope' }, 'GET', '/me')).status === 401,
  );

  console.log('\n— profiles —');
  let r = await api(a, 'GET', '/me');
  check('GET /me before onboarding → null', r.status === 200 && r.body === null, r);

  r = await api(a, 'POST', '/me', { username: nameA, timezone: 'America/Los_Angeles' });
  check('POST /me creates profile', r.status === 201 && r.body.username === nameA, r);
  const codeA = r.body.user_code;

  r = await api(b, 'POST', '/me', { username: nameB, timezone: 'Asia/Tokyo' });
  check('POST /me creates second profile', r.status === 201, r);

  r = await api(b, 'POST', '/me', { username: nameA, timezone: 'Asia/Tokyo' });
  check('duplicate username → 409 / 23505', r.status === 409 && r.body.code === '23505', r);

  r = await api(a, 'POST', '/me', { username: 'NO', timezone: 'UTC' });
  check('bad username → 4xx from the check constraint', r.status >= 400 && r.status < 500, r);

  r = await api(a, 'GET', '/me');
  check('GET /me returns profile + email', r.body?.username === nameA && r.body.email === a.email, r);

  r = await api(a, 'PATCH', '/me', { timezone: 'Europe/Berlin' });
  check('PATCH /me updates timezone', r.body?.timezone === 'Europe/Berlin', r);

  r = await api(a, 'PATCH', '/me', { timezone: 'America/Los_Angeles' });
  check('PATCH /me restores timezone', r.body?.timezone === 'America/Los_Angeles', r);

  r = await api(b, 'GET', `/profiles/${nameA}`);
  check('GET /profiles/:username finds A', r.body?.id === a.id, r);

  r = await api(b, 'GET', '/profiles/no_such_user_xx');
  check('GET /profiles/:username unknown → 404', r.status === 404, r);

  r = await api(b, 'GET', `/invite/${codeA}`);
  check('GET /invite/:code resolves username', r.body?.username === nameA, r);

  r = await api(b, 'GET', '/invite/zzzzzzzzzz');
  check('GET /invite/:code unknown → 404', r.status === 404, r);

  console.log('\n— drinks —');
  r = await api(a, 'GET', '/drinks');
  check('GET /drinks returns the curated list', Array.isArray(r.body) && r.body.length > 100, r.body?.length);
  check('GET /drinks is name-ordered', r.body[0].name.localeCompare(r.body[1].name) <= 0, [r.body?.[0], r.body?.[1]]);
  const lager = r.body.find((d) => d.normalized_name === 'lager');
  check('GET /drinks includes Lager', !!lager && lager.is_alcoholic === true, lager);

  console.log('\n— entries —');
  r = await api(a, 'POST', '/entries', {
    drink_id: lager.id,
    custom_drink_name: null,
    night_out_id: null,
    logged_at: new Date().toISOString(),
    location: 'Test Bar',
    note: 'e2e',
    recommended: true,
    new_night_out: { name: 'E2E Night', location: 'Testville' },
  });
  check('POST /entries with a new night out', r.status === 201 && !!r.body.id, r);
  entryId = r.body.id;

  r = await api(a, 'POST', '/entries', {
    drink_id: lager.id,
    custom_drink_name: 'Also this',
    night_out_id: null,
    logged_at: new Date().toISOString(),
    location: null,
    note: null,
    recommended: null,
  });
  check('POST /entries with both drink sources → 400 / 23514', r.status === 400 && r.body.code === '23514', r);

  r = await api(a, 'GET', `/entries/${entryId}`);
  check('GET /entries/:id seeds the edit form', r.body?.drink_name === 'Lager' && r.body.night_out_name === 'E2E Night', r);
  const nightId = r.body.night_out_id;
  check('POST /entries created the night out', !!nightId, r.body);

  r = await api(b, 'GET', `/entries/${entryId}`);
  check("GET /entries/:id hides another user's entry → 404", r.status === 404, r);

  r = await api(a, 'GET', '/entries/history');
  check('GET /entries/history returns own normalized names', r.body?.some((h) => h.normalized_drink_name === 'lager'), r);

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('not-a-real-jpeg')], { type: 'image/jpeg' }), 'p.jpg');
  r = await api(a, 'POST', `/entries/${entryId}/photo`, form);
  check('POST /entries/:id/photo stores under the owner folder', r.body?.photo_path === `${a.id}/${entryId}.jpg`, r);

  r = await api(a, 'GET', `/entries?user_id=${a.id}`);
  check('GET /entries returns own history', r.body?.length === 1 && r.body[0].id === entryId, r);
  check('GET /entries signs the photo', typeof r.body[0].photo_url === 'string' && r.body[0].photo_url.includes('token='), r.body?.[0]?.photo_url);
  check('GET /entries carries the night out label', r.body[0].night_out_name === 'E2E Night', r.body?.[0]);

  console.log('\n— visibility before friendship —');
  r = await api(b, 'GET', `/entries?user_id=${a.id}`);
  check("GET /entries for a stranger → 403", r.status === 403, r);
  r = await api(b, 'GET', `/profiles/${a.id}/stats`);
  check('GET /profiles/:id/stats for a stranger → 403', r.status === 403, r);
  r = await api(b, 'GET', `/night-outs/${nightId}`);
  check('GET /night-outs/:id for a stranger → 403', r.status === 403, r);
  r = await api(b, 'GET', '/feed');
  check("stranger's feed excludes A", !r.body?.some((e) => e.user_id === a.id), r.body?.length);
  r = await api(b, 'PUT', `/entries/${entryId}/reaction`);
  check("stranger cannot react → 403", r.status === 403, r);

  console.log('\n— friendships —');
  r = await api(a, 'GET', `/friendships/with/${b.id}`);
  check('GET /friendships/with/:id → null when none', r.status === 200 && r.body === null, r);

  r = await api(a, 'POST', '/friendships', { username: nameB });
  check('POST /friendships by username', r.status === 201 && !!r.body.id, r);
  const friendshipId = r.body.id;

  r = await api(a, 'POST', '/friendships', { username: nameB });
  check('POST /friendships duplicate → 409 / 23505', r.status === 409 && r.body.code === '23505', r);

  r = await api(a, 'POST', '/friendships', { username: 'no_such_user_xx' });
  check('POST /friendships unknown username → 404', r.status === 404, r);

  r = await api(a, 'POST', '/friendships', { addressee_id: a.id });
  check('POST /friendships to self → 400 / 23514', r.status === 400 && r.body.code === '23514', r);

  r = await api(b, 'GET', '/friendships');
  check('GET /friendships shows the incoming request with usernames',
    r.body?.[0]?.status === 'pending' && r.body[0].requester.username === nameA, r);

  r = await api(a, 'PATCH', `/friendships/${friendshipId}`);
  check('requester cannot accept → 404', r.status === 404, r);

  r = await api(b, 'PATCH', `/friendships/${friendshipId}`);
  check('addressee accepts', r.status === 200 && r.body.id === friendshipId, r);

  r = await api(b, 'PATCH', `/friendships/${friendshipId}`);
  check('accepting twice → 404', r.status === 404, r);

  r = await api(b, 'GET', `/friendships/with/${a.id}`);
  check('GET /friendships/with/:id → accepted row', r.body?.status === 'accepted', r);

  console.log('\n— visibility after friendship —');
  r = await api(b, 'GET', `/entries?user_id=${a.id}`);
  check("friend sees A's entries", r.status === 200 && r.body.length === 1, r);

  r = await api(b, 'GET', `/profiles/${a.id}/stats`);
  check('friend sees stats', r.body?.total_entries === 1 && r.body.unique_drinks === 1 && r.body.nights_out === 1, r);

  r = await api(b, 'GET', '/feed');
  const mine = r.body?.find((e) => e.user_id === a.id);
  check("friend's feed includes A's pre-acceptance entry", !!mine, r.body?.length);
  check('feed row carries drink, night, and signed photo',
    mine?.drink_name === 'Lager' && mine.night_out_name === 'E2E Night' && !!mine.photo_url, mine);

  r = await api(b, 'GET', `/feed?limit=1&before_logged_at=${encodeURIComponent(mine.logged_at)}&before_id=${mine.id}`);
  check('feed cursor excludes the row it points at', !r.body?.some((e) => e.id === mine.id), r.body);

  console.log('\n— night outs —');
  r = await api(a, 'GET', '/night-outs');
  check('GET /night-outs lists own sessions', r.body?.some((n) => n.id === nightId), r);

  r = await api(a, 'GET', `/night-outs?since=${new Date(Date.now() + 86400000).toISOString()}`);
  check('GET /night-outs?since filters by start time', r.body?.length === 0, r);

  r = await api(b, 'GET', `/night-outs/${nightId}`);
  check('friend reads the night out', r.body?.name === 'E2E Night', r);

  r = await api(b, 'GET', `/night-outs/${nightId}/entries`);
  check('friend reads the night out entries', r.body?.length === 1 && r.body[0].id === entryId, r);

  r = await api(a, 'GET', `/night-outs/${crypto.randomUUID()}`);
  check('GET /night-outs/:id unknown → 404', r.status === 404, r);

  console.log('\n— reactions —');
  r = await api(b, 'PUT', `/entries/${entryId}/reaction`);
  check('PUT /entries/:id/reaction', r.status === 200 && r.body.reacted === true, r);

  r = await api(b, 'PUT', `/entries/${entryId}/reaction`);
  check('PUT reaction is idempotent', r.status === 200 && r.body.reacted === true, r);

  r = await api(b, 'GET', '/feed');
  let reacted = r.body?.find((e) => e.id === entryId);
  check('feed carries reaction_count and reacted_by_me',
    reacted?.reaction_count === 1 && reacted.reacted_by_me === true, reacted);

  r = await api(a, 'GET', `/entries?user_id=${a.id}`);
  check("owner sees the count but not b's state",
    r.body?.[0]?.reaction_count === 1 && r.body[0].reacted_by_me === false, r.body?.[0]);

  console.log('\n— leaderboard —');
  r = await api(a, 'GET', '/leaderboard');
  check('GET /leaderboard has both members, A first',
    r.body?.length === 2 && r.body[0].username === nameA
      && r.body[0].unique_drinks === 1 && r.body[0].nights_out === 1
      && r.body[1].unique_drinks === 0, r.body);

  r = await api(a, 'GET', '/leaderboard?window=month');
  check('GET /leaderboard?window=month works', r.body?.length === 2, r.body);

  r = await api(b, 'PATCH', '/me', { leaderboard_opt_in: false });
  check('PATCH /me leaderboard_opt_in', r.status === 200, r);

  r = await api(a, 'GET', '/leaderboard');
  check("opted-out B leaves A's board", r.body?.length === 1 && r.body[0].username === nameA, r.body);

  r = await api(b, 'GET', '/leaderboard');
  check('opted-out B sees only themself', r.body?.length === 1 && r.body[0].username === nameB, r.body);

  r = await api(b, 'PATCH', '/me', { leaderboard_opt_in: true });
  check('opting back in restores B', r.status === 200 && (await api(a, 'GET', '/leaderboard')).body.length === 2, r);

  console.log('\n— recap —');
  r = await api(a, 'GET', '/recap');
  check('GET /recap counts the week', r.body?.total_entries === 1 && r.body.unique_drinks === 1 && r.body.nights_out === 1, r.body);
  check('GET /recap names the most reacted drink',
    r.body?.most_reacted?.drink_name === 'Lager' && r.body.most_reacted.reactions === 1, r.body?.most_reacted);
  check('GET /recap carries username and week_start', r.body?.username === nameA && !!r.body.week_start, r.body);

  r = await api(b, 'DELETE', `/entries/${entryId}/reaction`);
  check('DELETE /entries/:id/reaction', r.status === 200 && r.body.reacted === false, r);

  r = await api(b, 'GET', '/feed');
  reacted = r.body?.find((e) => e.id === entryId);
  check('unreact drops the count', reacted?.reaction_count === 0 && reacted.reacted_by_me === false, reacted);

  console.log('\n— updates and deletes —');
  r = await api(a, 'PATCH', `/entries/${entryId}`, {
    drink_id: null,
    custom_drink_name: 'Homemade Punch',
    night_out_id: nightId,
    logged_at: new Date().toISOString(),
    location: 'Kitchen',
    note: 'edited',
    recommended: false,
  });
  check('PATCH /entries/:id', r.status === 200, r);

  r = await api(a, 'GET', `/entries/${entryId}`);
  check('PATCH switched to a custom drink', r.body?.custom_drink_name === 'Homemade Punch' && r.body.drink_id === null, r);
  check('PATCH kept the photo', r.body?.photo_path === `${a.id}/${entryId}.jpg`, r.body);

  r = await api(a, 'GET', '/entries/history');
  check('the normalized-name trigger reran on update',
    r.body?.some((h) => h.normalized_drink_name === 'homemade punch'), r);

  r = await api(b, 'PATCH', `/entries/${entryId}`, {
    drink_id: null, custom_drink_name: 'Hijacked', night_out_id: null,
    logged_at: new Date().toISOString(), location: null, note: null, recommended: null,
  });
  check("friend cannot edit A's entry → 404", r.status === 404, r);

  r = await api(b, 'DELETE', `/entries/${entryId}`);
  check("friend cannot delete A's entry → 404", r.status === 404, r);

  r = await api(a, 'DELETE', `/entries/${entryId}/photo`);
  check('DELETE /entries/:id/photo clears the path', r.body?.photo_path === null, r);

  r = await api(a, 'GET', `/entries?user_id=${a.id}`);
  check('cleared photo drops the signed url', r.body?.[0]?.photo_url === null, r.body?.[0]);

  const avatarForm = new FormData();
  avatarForm.append('file', new Blob([Buffer.from('avatar-bytes')], { type: 'image/jpeg' }), 'a.jpg');
  r = await api(a, 'POST', '/me/avatar', avatarForm);
  check('POST /me/avatar stores under the owner folder', r.body?.avatar_url === `${a.id}/avatar.jpg`, r);

  r = await api(b, 'GET', '/feed');
  check('feed signs the avatar', typeof r.body?.find((e) => e.user_id === a.id)?.avatar_src === 'string', r.body?.[0]);

  r = await api(a, 'GET', '/me');
  check('GET /me signs the avatar', typeof r.body?.avatar_src === 'string' && r.body.avatar_src.includes('token='), r.body);

  r = await api(b, 'GET', `/profiles/${nameA}`);
  check('GET /profiles/:username signs the avatar', typeof r.body?.avatar_src === 'string', r.body);

  r = await api(a, 'DELETE', `/entries/${entryId}`);
  check('DELETE /entries/:id', r.body?.deleted === true, r);

  r = await api(a, 'GET', `/entries/${entryId}`);
  check('deleted entry is gone → 404', r.status === 404, r);

  r = await api(b, 'DELETE', `/friendships/${friendshipId}`);
  check('DELETE /friendships/:id (unfriend)', r.body?.deleted === true, r);

  r = await api(b, 'GET', `/entries?user_id=${a.id}`);
  check('unfriending revokes visibility immediately → 403', r.status === 403, r);

  r = await api(b, 'DELETE', `/friendships/${friendshipId}`);
  check('DELETE /friendships/:id twice → 404', r.status === 404, r);

  console.log('\n— blocks —');
  r = await api(a, 'POST', '/friendships', { username: nameB });
  const refriendId = r.body?.id;
  check('re-friending after unfriend works', r.status === 201 && !!refriendId, r);
  r = await api(b, 'PATCH', `/friendships/${refriendId}`);
  check('B accepts again', r.status === 200, r);

  r = await api(a, 'POST', '/blocks', { blocked_id: b.id });
  check('POST /blocks', r.status === 201 && r.body.blocked === true, r);

  r = await api(b, 'GET', `/friendships/with/${a.id}`);
  check('blocking dissolved the friendship', r.status === 200 && r.body === null, r);

  r = await api(b, 'GET', `/entries?user_id=${a.id}`);
  check("blocked B cannot see A's entries → 403", r.status === 403, r);

  r = await api(b, 'POST', '/friendships', { username: nameA });
  check('blocked B cannot re-friend → 403', r.status === 403, r);

  r = await api(a, 'POST', '/friendships', { username: nameB });
  check('blocker cannot re-friend either → 403', r.status === 403, r);

  r = await api(a, 'GET', '/blocks');
  check('GET /blocks lists B with username', r.body?.length === 1 && r.body[0].username === nameB, r);

  r = await api(b, 'GET', '/blocks');
  check("B's own block list is empty", r.body?.length === 0, r);

  r = await api(a, 'POST', '/blocks', { blocked_id: a.id });
  check('blocking yourself → 400 / 23514', r.status === 400 && r.body.code === '23514', r);

  r = await api(a, 'DELETE', `/blocks/${b.id}`);
  check('DELETE /blocks/:id (unblock)', r.body?.blocked === false, r);

  r = await api(a, 'DELETE', `/blocks/${b.id}`);
  check('unblocking twice → 404', r.status === 404, r);

  r = await api(b, 'POST', '/friendships', { username: nameA });
  check('after unblock, requests flow again', r.status === 201, r);

  console.log('\n— account deletion —');
  r = await api(a, 'DELETE', '/me');
  check('DELETE /me', r.body?.deleted === true, r);

  r = await api(b, 'GET', `/profiles/${nameA}`);
  check('deleting the auth user cascades the profile → 404', r.status === 404, r);
} finally {
  // Belt and braces: A is usually gone via DELETE /me already.
  for (const u of [a, b]) {
    await admin(`/admin/users/${u.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
