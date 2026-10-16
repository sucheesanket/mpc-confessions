/* ==========================================================
   MPC Party Night - backend
   Run:  node server.js        (needs Node.js 16 or newer)
   No "npm install" required - it only uses built-in modules.
   ========================================================== */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/* ---------- SETTINGS (edit these) ---------- */
const PORT = process.env.PORT || 3000;
// Secret code that students need to sign up. Post it ONLY where followers of
// @mpc.confessions can see it (followers-only story / close-friends story / DM).
const COLLEGE_CODE = (process.env.COLLEGE_CODE || 'MPC2026').trim();
// Password for the admin links (see bottom of this file). CHANGE IT.
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-this-admin-key';
const INSTAGRAM_URL = 'https://www.instagram.com/mpc.confessions';
const PARTY = {
  title: 'MPC Party Night',
  tagline: 'find your +1 for the night',
  when: 'Oct 11 to Oct 19, 2026. Venue will be announced on @mpc.confessions',
};
const MIN_AGE = 18;
/* ------------------------------------------- */

const DB_FILE = path.join(__dirname, 'data.json');
let db = { users: {}, sessions: {}, swipes: {}, matches: {}, messages: [], reports: [], blocks: {}, seq: 0 };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) { /* first run */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), (err) => {
      if (!err) fs.rename(DB_FILE + '.tmp', DB_FILE, () => {});
    });
  }, 300);
}

/* ---------- helpers ---------- */
const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const fail = (res, code, msg) => send(res, code, { error: msg });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1.5e6) { reject(new Error('Upload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch (e) { reject(new Error('Bad request')); }
    });
    req.on('error', reject);
  });
}

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function checkPw(pw, u) {
  const a = Buffer.from(hashPw(pw, u.salt), 'hex');
  const b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ageOf(dob) {
  const d = new Date(dob + 'T00:00:00');
  if (isNaN(d)) return null;
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a;
}

const pub = (u) => ({ id: u.id, name: u.name, age: ageOf(u.dob), gender: u.gender, bio: u.bio, photo: u.photo });
const mkey = (a, b) => [a, b].sort().join('|');
const isBlocked = (a, b) => (db.blocks[a] || []).includes(b) || (db.blocks[b] || []).includes(a);
const interestOf = (u) => Array.isArray(u.interest) ? u.interest : (u.interest === 'everyone' ? ['male', 'female', 'other'] : [u.interest]);
const compatible = (me, o) => interestOf(me).includes(o.gender) && interestOf(o).includes(me.gender);

function newSession(id) {
  const t = crypto.randomBytes(32).toString('hex');
  db.sessions[t] = { id, ts: Date.now() };
  save();
  return t;
}
function auth(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const s = db.sessions[t];
  if (!s || Date.now() - s.ts > 30 * 24 * 3600 * 1000) return null;
  const u = db.users[s.id];
  return u ? { u, t } : null;
}

// very small brute-force guard (per IP)
const fails = {};
const WINDOW = 10 * 60 * 1000;
const tooMany = (ip) => fails[ip] && fails[ip].n >= 8 && Date.now() - fails[ip].t < WINDOW;
function noteFail(ip) {
  const f = (fails[ip] = fails[ip] || { n: 0, t: 0 });
  if (Date.now() - f.t > WINDOW) f.n = 0;
  f.n++; f.t = Date.now();
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const ip = req.socket.remoteAddress;
  const route = req.method + ' ' + url.pathname;

  if (route === 'GET /api/config') {
    return send(res, 200, { instagram: INSTAGRAM_URL, party: PARTY, minAge: MIN_AGE });
  }

  /* ----- sign up ----- */
  if (route === 'POST /api/signup') {
    if (tooMany(ip)) return fail(res, 429, 'Too many tries. Wait a few minutes.');
    const b = await readBody(req);
    if (String(b.code || '').trim().toLowerCase() !== COLLEGE_CODE.toLowerCase()) {
      noteFail(ip);
      return fail(res, 403, 'Wrong access code. Follow @mpc.confessions to get it.');
    }
    const id = String(b.userId || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    const bio = String(b.bio || '').trim().slice(0, 120);
    const pw = String(b.password || '');
    const age = ageOf(String(b.dob || ''));
    if (!/^[a-z0-9_.]{3,20}$/.test(id)) return fail(res, 400, 'User ID: 3-20 letters, numbers, _ or .');
    if (name.length < 2 || name.length > 40) return fail(res, 400, 'Enter your name.');
    if (age === null || age > 60) return fail(res, 400, 'Enter a valid date of birth.');
    if (age < MIN_AGE) return fail(res, 403, 'You must be ' + MIN_AGE + '+ to join.');
    if (!['male', 'female', 'other'].includes(b.gender)) return fail(res, 400, 'Pick your gender.');
    const interest = (Array.isArray(b.interest) ? b.interest : []).filter((x, i, arr) => ['male', 'female', 'other'].includes(x) && arr.indexOf(x) === i);
    if (!interest.length) return fail(res, 400, 'Pick your partner preference.');
    if (pw.length < 6) return fail(res, 400, 'Password needs 6+ characters.');
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(String(b.photo || '')) || b.photo.length > 900000)
      return fail(res, 400, 'Add a profile photo.');
    if (db.users[id]) return fail(res, 409, 'That user ID is taken.');

    const salt = crypto.randomBytes(16).toString('hex');
    db.users[id] = {
      id, name, dob: b.dob, gender: b.gender, interest, bio,
      photo: b.photo, salt, hash: hashPw(pw, salt), createdAt: Date.now(),
    };
    save();
    return send(res, 200, { token: newSession(id), me: pub(db.users[id]) });
  }

  /* ----- log in ----- */
  if (route === 'POST /api/login') {
    if (tooMany(ip)) return fail(res, 429, 'Too many tries. Wait a few minutes.');
    const b = await readBody(req);
    const u = db.users[String(b.userId || '').trim().toLowerCase()];
    if (!u || !checkPw(String(b.password || ''), u)) {
      noteFail(ip);
      return fail(res, 401, 'Wrong user ID or password.');
    }
    return send(res, 200, { token: newSession(u.id), me: pub(u) });
  }

  /* ----- everything below needs login ----- */
  const a = auth(req);
  if (!a) return fail(res, 401, 'Please log in.');
  const me = a.u;

  if (route === 'GET /api/me') return send(res, 200, { me: pub(me) });

  if (route === 'POST /api/logout') {
    delete db.sessions[a.t]; save();
    return send(res, 200, { ok: true });
  }

  if (route === 'DELETE /api/me') {
    const id = me.id;
    delete db.users[id];
    delete db.swipes[id];
    Object.values(db.swipes).forEach((s) => delete s[id]);
    Object.keys(db.matches).forEach((k) => { if (k.split('|').includes(id)) delete db.matches[k]; });
    db.messages = db.messages.filter((m) => !m.key.split('|').includes(id));
    Object.keys(db.sessions).forEach((t) => { if (db.sessions[t].id === id) delete db.sessions[t]; });
    save();
    return send(res, 200, { ok: true });
  }

  /* ----- swipe deck ----- */
  if (route === 'GET /api/deck') {
    const done = db.swipes[me.id] || {};
    const list = Object.values(db.users).filter((o) =>
      o.id !== me.id && !(o.id in done) && !isBlocked(me.id, o.id) && compatible(me, o));
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return send(res, 200, { people: list.slice(0, 8).map(pub) });
  }

  if (route === 'POST /api/swipe') {
    const b = await readBody(req);
    const to = db.users[String(b.to || '')];
    if (!to || to.id === me.id || isBlocked(me.id, to.id)) return fail(res, 400, 'Not available.');
    const like = !!b.like;
    (db.swipes[me.id] = db.swipes[me.id] || {})[to.id] = like;
    let match = false;
    if (like && db.swipes[to.id] && db.swipes[to.id][me.id] === true) {
      const k = mkey(me.id, to.id);
      if (!db.matches[k]) db.matches[k] = { a: me.id, b: to.id, ts: Date.now(), seen: {} };
      match = true;
    }
    save();
    return send(res, 200, { match, user: match ? pub(to) : null });
  }

  /* ----- matches list ----- */
  if (route === 'GET /api/matches') {
    const out = [];
    for (const [k, m] of Object.entries(db.matches)) {
      if (m.a !== me.id && m.b !== me.id) continue;
      const oid = m.a === me.id ? m.b : m.a;
      const o = db.users[oid];
      if (!o || isBlocked(me.id, oid)) continue;
      const msgs = db.messages.filter((x) => x.key === k);
      const last = msgs[msgs.length - 1] || null;
      const seen = (m.seen && m.seen[me.id]) || 0;
      out.push({
        user: pub(o), ts: m.ts,
        last: last ? { text: last.text, mine: last.from === me.id, ts: last.ts } : null,
        unread: msgs.filter((x) => x.from !== me.id && x.n > seen).length,
      });
    }
    out.sort((x, y) => ((y.last && y.last.ts) || y.ts) - ((x.last && x.last.ts) || x.ts));
    return send(res, 200, { matches: out });
  }

  /* ----- chat ----- */
  const chat = url.pathname.match(/^\/api\/chat\/([a-z0-9_.]+)$/);
  if (chat) {
    const oid = chat[1];
    const k = mkey(me.id, oid);
    const m = db.matches[k];
    if (!m || !db.users[oid] || isBlocked(me.id, oid)) return fail(res, 403, 'No match with this person.');

    if (req.method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0);
      const msgs = db.messages.filter((x) => x.key === k && x.n > after)
        .map((x) => ({ n: x.n, mine: x.from === me.id, text: x.text, ts: x.ts }));
      if (msgs.length || after === 0) {
        m.seen = m.seen || {};
        m.seen[me.id] = db.seq;
        save();
      }
      return send(res, 200, { messages: msgs, other: pub(db.users[oid]) });
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const text = String(b.text || '').trim().slice(0, 500);
      if (!text) return fail(res, 400, 'Empty message.');
      const msg = { n: ++db.seq, key: k, from: me.id, text, ts: Date.now() };
      db.messages.push(msg);
      m.seen = m.seen || {};
      m.seen[me.id] = msg.n;
      save();
      return send(res, 200, { n: msg.n });
    }
  }

  /* ----- report & block ----- */
  if (route === 'POST /api/report') {
    const b = await readBody(req);
    const o = db.users[String(b.id || '')];
    if (!o || o.id === me.id) return fail(res, 400, 'Not found.');
    db.reports.push({ by: me.id, against: o.id, reason: String(b.reason || '').slice(0, 300), ts: Date.now() });
    (db.blocks[me.id] = db.blocks[me.id] || []).push(o.id);
    save();
    return send(res, 200, { ok: true });
  }

  return fail(res, 404, 'Not found.');
}

/* ---------- admin (open these links in a browser) ----------
   See reports : /admin/reports?key=YOUR_ADMIN_KEY
   Remove a user: /admin/remove?key=YOUR_ADMIN_KEY&id=THEIR_USERID
------------------------------------------------------------ */
function admin(req, res, url) {
  const key = url.searchParams.get('key') || '';
  if (key.length !== ADMIN_KEY.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(ADMIN_KEY)))
    return fail(res, 403, 'Wrong key.');
  if (url.pathname === '/admin/reports') {
    return send(res, 200, {
      totalUsers: Object.keys(db.users).length,
      totalMatches: Object.keys(db.matches).length,
      reports: db.reports.map((r) => ({ ...r, when: new Date(r.ts).toLocaleString() })),
    });
  }
  if (url.pathname === '/admin/remove') {
    const id = String(url.searchParams.get('id') || '');
    if (!db.users[id]) return fail(res, 404, 'No such user.');
    delete db.users[id]; delete db.swipes[id];
    Object.values(db.swipes).forEach((s) => delete s[id]);
    Object.keys(db.matches).forEach((k) => { if (k.split('|').includes(id)) delete db.matches[k]; });
    db.messages = db.messages.filter((m) => !m.key.split('|').includes(id));
    Object.keys(db.sessions).forEach((t) => { if (db.sessions[t].id === id) delete db.sessions[t]; });
    save();
    return send(res, 200, { removed: id });
  }
  return fail(res, 404, 'Not found.');
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/admin/')) return admin(req, res, url);
    // Static frontend assets. Resolve paths beneath /public only to prevent traversal.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' });
      return res.end('Method not allowed');
    }
    const publicDir = path.join(__dirname, 'public');
    const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const filePath = path.resolve(publicDir, '.' + requestedPath);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
      res.writeHead(403); return res.end('Forbidden');
    }
    let contentType = 'application/octet-stream';
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
    contentType = types[ext] || contentType;
    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(err.code === 'ENOENT' ? 'Not found' : 'Unable to read file'); }
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
      return res.end(req.method === 'HEAD' ? undefined : content);
    });
  } catch (e) {
    if (!res.headersSent) fail(res, 400, e.message || 'Something went wrong.');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  MPC Party Night is running!\n');
  console.log('  On this computer :  http://localhost:' + PORT);
  Object.values(os.networkInterfaces()).flat().forEach((i) => {
    if (i && i.family === 'IPv4' && !i.internal) console.log('  On your Wi-Fi    :  http://' + i.address + ':' + PORT + '   (open this on phones)');
  });
  console.log('\n  Student access code : ' + COLLEGE_CODE);
  console.log('  Stop the server with Ctrl + C\n');
});
