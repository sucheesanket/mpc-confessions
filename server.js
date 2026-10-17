/* MPC Party Night backend - MongoDB Atlas storage */
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const COLLEGE_CODE = (process.env.COLLEGE_CODE || 'MPC2026').trim();
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-this-admin-key';
const MONGODB_URI = process.env.MONGODB_URI;
const INSTAGRAM_URL = 'https://www.instagram.com/mpc.confessions';
const PARTY = { title: 'MPC Party Night', tagline: 'find your +1 for the night', when: 'Oct 11 to Oct 19, 2026. Venue will be announced on @mpc.confessions' };
const MIN_AGE = 18;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI environment variable. Add it to Render Environment or your local environment.');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
let collections;
const fails = Object.create(null);
const WINDOW = 10 * 60 * 1000;
const tooMany = (ip) => fails[ip] && fails[ip].n >= 8 && Date.now() - fails[ip].t < WINDOW;
function noteFail(ip) {
  const f = (fails[ip] = fails[ip] || { n: 0, t: 0 });
  if (Date.now() - f.t > WINDOW) f.n = 0;
  f.n++; f.t = Date.now();
}

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const fail = (res, code, msg) => send(res, code, { error: msg });
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1.5e6) { reject(new Error('Upload too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('Bad request')); } });
    req.on('error', reject);
  });
}
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function checkPw(pw, u) {
  try { const a = Buffer.from(hashPw(pw, u.salt), 'hex'); const b = Buffer.from(u.hash, 'hex'); return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b); } catch { return false; }
}
function ageOf(dob) {
  const d = new Date(dob + 'T00:00:00'); if (isNaN(d)) return null;
  const n = new Date(); let a = n.getFullYear() - d.getFullYear(); const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--; return a;
}
const pub = u => ({ id: u.id, name: u.name, age: ageOf(u.dob), gender: u.gender, bio: u.bio, photo: u.photo });
const mkey = (a, b) => [a, b].sort().join('|');
const interestOf = u => Array.isArray(u.interest) ? u.interest : (u.interest === 'everyone' ? ['male','female','other'] : [u.interest]);
const compatible = (me, o) => interestOf(me).includes(o.gender) && interestOf(o).includes(me.gender);
async function isBlocked(a, b) {
  const [ab, ba] = await Promise.all([
    collections.blocks.findOne({ userId: a, blockedId: b }),
    collections.blocks.findOne({ userId: b, blockedId: a })
  ]);
  return !!(ab || ba);
}
async function createSession(id) {
  const token = crypto.randomBytes(32).toString('hex');
  await collections.sessions.insertOne({ token, userId: id, ts: Date.now() });
  return token;
}
async function auth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const session = await collections.sessions.findOne({ token });
  if (!session || Date.now() - session.ts > 30 * 24 * 3600 * 1000) {
    if (session) await collections.sessions.deleteOne({ token });
    return null;
  }
  const u = await collections.users.findOne({ id: session.userId });
  return u ? { u, token } : null;
}
async function removeUser(id) {
  await Promise.all([
    collections.users.deleteOne({ id }),
    collections.sessions.deleteMany({ userId: id }),
    collections.swipes.deleteMany({ $or: [{ userId: id }, { targetId: id }] }),
    collections.matches.deleteMany({ $or: [{ a: id }, { b: id }] }),
    collections.messages.deleteMany({ participants: id }),
    collections.reports.deleteMany({ $or: [{ by: id }, { against: id }] }),
    collections.blocks.deleteMany({ $or: [{ userId: id }, { blockedId: id }] })
  ]);
}

async function api(req, res, url) {
  const ip = req.socket.remoteAddress || 'unknown';
  const route = req.method + ' ' + url.pathname;
  if (route === 'GET /api/config') return send(res, 200, { instagram: INSTAGRAM_URL, party: PARTY, minAge: MIN_AGE });

  if (route === 'POST /api/signup') {
    if (tooMany(ip)) return fail(res, 429, 'Too many tries. Wait a few minutes.');
    const b = await readBody(req);
    if (String(b.code || '').trim().toLowerCase() !== COLLEGE_CODE.toLowerCase()) { noteFail(ip); return fail(res, 403, 'Wrong access code. Follow @mpc.confessions to get it.'); }
    const id = String(b.userId || '').trim().toLowerCase();
    const name = String(b.name || '').trim(); const bio = String(b.bio || '').trim().slice(0,120); const pw = String(b.password || ''); const dob = String(b.dob || ''); const age = ageOf(dob);
    if (!/^[a-z0-9_.]{3,20}$/.test(id)) return fail(res, 400, 'User ID: 3-20 letters, numbers, _ or .');
    if (name.length < 2 || name.length > 40) return fail(res, 400, 'Enter your name.');
    if (age === null || age > 60) return fail(res, 400, 'Enter a valid date of birth.');
    if (age < MIN_AGE) return fail(res, 403, 'You must be ' + MIN_AGE + '+ to join.');
    if (!['male','female','other'].includes(b.gender)) return fail(res, 400, 'Pick your gender.');
    const interest = (Array.isArray(b.interest) ? b.interest : []).filter((x,i,arr) => ['male','female','other'].includes(x) && arr.indexOf(x) === i);
    if (!interest.length) return fail(res, 400, 'Pick your partner preference.');
    if (pw.length < 6) return fail(res, 400, 'Password needs 6+ characters.');
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(b.photo || '')) || b.photo.length > 900000) return fail(res, 400, 'Add a profile photo.');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { id, name, dob, gender: b.gender, interest, bio, photo: b.photo, salt, hash: hashPw(pw, salt), createdAt: Date.now() };
    try { await collections.users.insertOne(user); } catch (e) { if (e && e.code === 11000) return fail(res, 409, 'That user ID is taken.'); throw e; }
    return send(res, 200, { token: await createSession(id), me: pub(user) });
  }

  if (route === 'POST /api/login') {
    if (tooMany(ip)) return fail(res, 429, 'Too many tries. Wait a few minutes.');
    const b = await readBody(req); const id = String(b.userId || '').trim().toLowerCase();
    const u = await collections.users.findOne({ id });
    if (!u || !checkPw(String(b.password || ''), u)) { noteFail(ip); return fail(res, 401, 'Wrong user ID or password.'); }
    return send(res, 200, { token: await createSession(u.id), me: pub(u) });
  }

  const a = await auth(req);
  if (!a) return fail(res, 401, 'Please log in.');
  const me = a.u;
  if (route === 'GET /api/me') return send(res, 200, { me: pub(me) });
  if (route === 'POST /api/logout') { await collections.sessions.deleteOne({ token: a.token }); return send(res, 200, { ok: true }); }
  if (route === 'DELETE /api/me') { await removeUser(me.id); return send(res, 200, { ok: true }); }

  if (route === 'GET /api/deck') {
    const [users, swipes] = await Promise.all([collections.users.find({ id: { $ne: me.id } }).toArray(), collections.swipes.find({ userId: me.id }).toArray()]);
    const done = new Set(swipes.map(s => s.targetId)); const list = [];
    for (const o of users) if (!done.has(o.id) && compatible(me,o) && !(await isBlocked(me.id,o.id))) list.push(o);
    for (let i=list.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [list[i],list[j]]=[list[j],list[i]]; }
    return send(res, 200, { people: list.slice(0,8).map(pub) });
  }

  if (route === 'POST /api/swipe') {
    const b = await readBody(req); const toId = String(b.to || ''); const to = await collections.users.findOne({ id: toId });
    if (!to || to.id === me.id || await isBlocked(me.id,to.id)) return fail(res,400,'Not available.');
    const like = !!b.like;
    await collections.swipes.updateOne({ userId: me.id, targetId: to.id }, { $set: { userId: me.id, targetId: to.id, like, ts: Date.now() } }, { upsert: true });
    let match = false;
    if (like) {
      const otherSwipe = await collections.swipes.findOne({ userId: to.id, targetId: me.id, like: true });
      if (otherSwipe) {
        const key = mkey(me.id,to.id);
        await collections.matches.updateOne({ key }, { $setOnInsert: { key, a: me.id, b: to.id, ts: Date.now(), seen: {} } }, { upsert: true });
        match = true;
      }
    }
    return send(res,200,{ match, user: match ? pub(to) : null });
  }

  if (route === 'GET /api/matches') {
    const matches = await collections.matches.find({ $or: [{ a: me.id }, { b: me.id }] }).toArray(); const out=[];
    for (const m of matches) {
      const oid = m.a === me.id ? m.b : m.a; const o = await collections.users.findOne({ id: oid });
      if (!o || await isBlocked(me.id,oid)) continue;
      const msgs = await collections.messages.find({ key: m.key }).sort({ n: 1 }).toArray(); const last=msgs[msgs.length-1] || null; const seen=(m.seen && m.seen[me.id]) || 0;
      out.push({ user: pub(o), ts: m.ts, last: last ? { text:last.text, mine:last.from===me.id, ts:last.ts } : null, unread: msgs.filter(x=>x.from!==me.id && x.n>seen).length });
    }
    out.sort((x,y)=>((y.last&&y.last.ts)||y.ts)-((x.last&&x.last.ts)||x.ts));
    return send(res,200,{ matches:out });
  }

  const chat = url.pathname.match(/^\/api\/chat\/([a-z0-9_.]+)$/);
  if (chat) {
    const oid=chat[1]; const key=mkey(me.id,oid); const matchDoc=await collections.matches.findOne({ key }); const other=await collections.users.findOne({ id:oid });
    if (!matchDoc || !other || await isBlocked(me.id,oid)) return fail(res,403,'No match with this person.');
    if (req.method === 'GET') {
      const after=Number(url.searchParams.get('after')||0); const msgs=await collections.messages.find({ key, n:{ $gt:after } }).sort({ n:1 }).toArray();
      if (msgs.length || after===0) await collections.matches.updateOne({ key }, { $set: { [`seen.${me.id}`]: await currentSequence() } });
      return send(res,200,{ messages:msgs.map(x=>({ n:x.n, mine:x.from===me.id, text:x.text, ts:x.ts })), other:pub(other) });
    }
    if (req.method === 'POST') {
      const b=await readBody(req); const text=String(b.text||'').trim().slice(0,500); if(!text) return fail(res,400,'Empty message.');
      const n=await nextSequence(); await collections.messages.insertOne({ n, key, participants:[me.id,oid], from:me.id, text, ts:Date.now() });
      await collections.matches.updateOne({ key },{ $set:{ [`seen.${me.id}`]:n } }); return send(res,200,{ n });
    }
  }

  if (route === 'POST /api/report') {
    const b=await readBody(req); const oid=String(b.id||''); const other=await collections.users.findOne({id:oid});
    if(!other||other.id===me.id) return fail(res,400,'Not found.');
    await collections.reports.insertOne({ by:me.id, against:other.id, reason:String(b.reason||'').slice(0,300), ts:Date.now() });
    await collections.blocks.updateOne({ userId:me.id, blockedId:other.id },{ $setOnInsert:{ userId:me.id, blockedId:other.id, ts:Date.now() } },{upsert:true});
    return send(res,200,{ok:true});
  }
  return fail(res,404,'Not found.');
}
let seqCache = 0;
async function nextSequence() { const c = await collections.counters.findOneAndUpdate({ _id:'messages' }, { $inc:{ value:1 } }, { upsert:true, returnDocument:'after', includeResultMetadata:false }); seqCache = c.value; return seqCache; }
async function currentSequence() { const c=await collections.counters.findOne({ _id:'messages' }); return c ? c.value : 0; }

async function admin(req,res,url) {
  const key=url.searchParams.get('key')||'';
  if(key.length!==ADMIN_KEY.length||!crypto.timingSafeEqual(Buffer.from(key),Buffer.from(ADMIN_KEY))) return fail(res,403,'Wrong key.');
  if(url.pathname==='/admin/reports') {
    const [totalUsers,totalMatches,reports]=await Promise.all([collections.users.countDocuments(),collections.matches.countDocuments(),collections.reports.find({}).sort({ts:-1}).toArray()]);
    return send(res,200,{totalUsers,totalMatches,reports:reports.map(r=>({...r,when:new Date(r.ts).toLocaleString()}))});
  }
  if(url.pathname==='/admin/remove') { const id=String(url.searchParams.get('id')||''); if(!await collections.users.findOne({id})) return fail(res,404,'No such user.'); await removeUser(id); return send(res,200,{removed:id}); }
  return fail(res,404,'Not found.');
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','no-referrer');
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')) return await api(req,res,url);
    if(url.pathname.startsWith('/admin/')) return await admin(req,res,url);
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Content-Type':'text/plain; charset=utf-8','Allow':'GET, HEAD'});return res.end('Method not allowed');}
    const publicDir=path.join(__dirname,'public'); const requested=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname); const filePath=path.resolve(publicDir,'.'+requested);
    if(filePath!==publicDir&&!filePath.startsWith(publicDir+path.sep)){res.writeHead(403);return res.end('Forbidden');}
    const ext=path.extname(filePath).toLowerCase(); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
    fs.readFile(filePath,(err,content)=>{if(err){res.writeHead(err.code==='ENOENT'?404:500,{'Content-Type':'text/plain; charset=utf-8'});return res.end(err.code==='ENOENT'?'Not found':'Unable to read file');}res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=3600'});return res.end(req.method==='HEAD'?undefined:content);});
  } catch(e) { console.error('Request error:',e); if(!res.headersSent) fail(res,500,'Server error. Please try again.'); }
});

async function start() {
  await client.connect();
  const db=client.db('mpc_party_night');
  collections={ users:db.collection('users'), sessions:db.collection('sessions'), swipes:db.collection('swipes'), matches:db.collection('matches'), messages:db.collection('messages'), reports:db.collection('reports'), blocks:db.collection('blocks'), counters:db.collection('counters') };
  await Promise.all([
    collections.users.createIndex({id:1},{unique:true}),
    collections.sessions.createIndex({token:1},{unique:true}),
    collections.swipes.createIndex({userId:1,targetId:1},{unique:true}),
    collections.matches.createIndex({key:1},{unique:true}),
    collections.messages.createIndex({key:1,n:1}),
    collections.messages.createIndex({participants:1}),
    collections.blocks.createIndex({userId:1,blockedId:1},{unique:true})
  ]);
  server.listen(PORT,'0.0.0.0',()=>console.log(`MPC Party Night listening on port ${PORT}; connected to MongoDB Atlas.`));
}
start().catch(err=>{console.error('Unable to connect to MongoDB Atlas:',err.message);process.exit(1);});
process.on('SIGTERM',async()=>{server.close(async()=>{await client.close();process.exit(0);});});
process.on('SIGINT',async()=>{server.close(async()=>{await client.close();process.exit(0);});});
