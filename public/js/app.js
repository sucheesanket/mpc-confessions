/* =====================================================
   helpers
===================================================== */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let token = localStorage.getItem('mpc_token') || '';
let me = null, CFG = null, curTab = 'discover';
const timers = {};
const stopTimers = () => { Object.keys(timers).forEach((k) => { clearInterval(timers[k]); delete timers[k]; }); };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let d = {};
  try { d = await r.json(); } catch (e) {}
  if (!r.ok) {
    if (r.status === 401 && token && !opts.quiet) { endSession(); }
    throw new Error(d.error || 'Something went wrong. Try again.');
  }
  return d;
}

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2800);
}

function startSession(d) {
  token = d.token; me = d.me;
  localStorage.setItem('mpc_token', token);
  deck = []; seen.clear(); lastMatchCount = null;
  viewApp('discover');
}
function endSession() {
  token = ''; me = null; localStorage.removeItem('mpc_token');
  stopTimers(); deck = []; seen.clear();
  viewGate();
}

const ICON = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5 4.3 12.9A5 5 0 0 1 11.4 5.8l.6.6.6-.6a5 5 0 0 1 7.1 7.1z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9.5L4 20z"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M3 11.5 21 3l-8.5 18-2.3-7.2z"/></svg>',
};

/* =====================================================
   landing (follow gate)
===================================================== */
function viewGate() {
  stopTimers();
  const strip = '<span>party night</span><i>✦</i><span>oct 11 to oct 19</span><i>✦</i><span>find your +1</span><i>✦</i><span>mpc only</span><i>✦</i>'.repeat(8);
  app.innerHTML = `
    <div class="strip" aria-hidden="true"><div class="strip-in">${strip}</div></div>
    <main class="wrap gate">
      <div class="sticker">mpc students only</div>
      <h1 class="mega">who’s your<br>+1 for<br>party night?</h1>
      <p class="lead">Swipe on people from your own college. Match, chat, and walk in together.</p>
      <section class="glass gate-card" aria-label="Get in">
        <h2>First, follow the page</h2>
        <a class="btn ghost" href="${esc(CFG.instagram)}" target="_blank" rel="noopener noreferrer">Follow @mpc.confessions</a>
        <p class="fine">The college access code is shared with followers on that page. You’ll need it to sign up.</p>
        <label class="check"><input type="checkbox" id="follow"><span>I follow @mpc.confessions</span></label>
        <div class="stack">
          <button class="btn" id="go-signup" disabled>Create my profile</button>
          <button class="btn ghost" id="go-login">I already have an account</button>
        </div>
      </section>
      <p class="fine" style="margin-top:18px">${esc(CFG.party.when)}</p>
    </main>`;
  const cb = $('#follow'), su = $('#go-signup');
  cb.addEventListener('change', () => { su.disabled = !cb.checked; });
  su.addEventListener('click', viewSignup);
  $('#go-login').addEventListener('click', viewLogin);
}

/* =====================================================
   sign up
===================================================== */
function fileToJpeg(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const W = 600, H = 800, c = document.createElement('canvas');
      c.width = W; c.height = H;
      const r = Math.max(W / img.width, H / img.height), w = img.width * r, h = img.height * r;
      c.getContext('2d').drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => rej(new Error('Could not read that image.'));
    img.src = url;
  });
}

function viewSignup() {
  const d = new Date(); d.setFullYear(d.getFullYear() - CFG.minAge);
  const maxDob = d.toISOString().slice(0, 10);
  let photo = '';
  app.innerHTML = `
    <main class="wrap formwrap">
      <button class="back" id="back">‹ Back</button>
      <h1 class="h">Make your profile</h1>
      <form class="card glass" id="f" novalidate>
        <label class="photo" id="pbox">
          <span id="ptxt">+ add your best photo</span>
          <input type="file" accept="image/*" id="pfile" aria-label="Profile photo">
        </label>
        <label class="f">Name<input type="text" name="name" maxlength="40" autocomplete="name" placeholder="What should people call you?"></label>
        <label class="f">User ID <small>letters, numbers, _ or . (you’ll log in with this)</small>
          <input type="text" name="userId" maxlength="20" autocapitalize="none" autocomplete="username" placeholder="e.g. riya.07"></label>
        <label class="f">Date of birth <small>only your age is shown. Must be ${CFG.minAge}+</small>
          <input type="date" name="dob" max="${maxDob}"></label>
        <div class="f">I am
          <div class="chips" role="radiogroup" aria-label="Gender">
            <label><input type="radio" name="gender" value="male"><span>Male</span></label>
            <label><input type="radio" name="gender" value="female"><span>Female</span></label>
            <label><input type="radio" name="gender" value="other"><span>Other</span></label>
          </div></div>
        <div class="f">My partner <small>tick one or more</small>
          <div class="chips" role="group" aria-label="My partner">
            <label><input type="checkbox" name="interest" value="male"><span>Guys</span></label>
            <label><input type="checkbox" name="interest" value="female"><span>Girls</span></label>
            <label><input type="checkbox" name="interest" value="other"><span>Others</span></label>
          </div></div>
        <label class="f">Bio <small>optional, 120 characters</small>
          <textarea name="bio" maxlength="120" placeholder="dancefloor menace, chai addict…"></textarea></label>
        <label class="f">Password <small>6 or more characters</small>
          <input type="password" name="password" autocomplete="new-password"></label>
        <label class="f">College access code <small>shared by @mpc.confessions</small>
          <input type="text" name="code" autocapitalize="characters" autocomplete="off"></label>
        <label class="check"><input type="checkbox" name="ok"><span class="fine" style="opacity:1">I’m ${CFG.minAge}+, I study at MPC, and I’ll be respectful. My photo, name, age and bio will be visible to other MPC students.</span></label>
        <div class="err" id="err" role="alert"></div>
        <button class="btn" id="sub">Create profile</button>
      </form>
    </main>`;
  const err = (m) => { $('#err').textContent = m; };
  $('#back').addEventListener('click', viewGate);
  $('#pfile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      photo = await fileToJpeg(f);
      let im = $('#pbox img');
      if (!im) { im = document.createElement('img'); im.alt = 'Your profile photo preview'; $('#pbox').prepend(im); }
      im.src = photo; $('#ptxt').hidden = true; err('');
    } catch (x) { err(x.message); }
  });
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); err('');
    const f = e.target.elements, v = (n) => f[n].value.trim();
    if (!photo) return err('Add a profile photo first.');
    if (v('name').length < 2) return err('Enter your name.');
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(v('userId'))) return err('User ID: 3-20 letters, numbers, _ or .');
    if (!v('dob')) return err('Enter your date of birth.');
    if (!f.gender.value) return err('Pick your gender.');
    const interest = [...document.querySelectorAll('input[name=interest]:checked')].map((x) => x.value);
    if (!interest.length) return err('Pick your partner preference.');
    if (f.password.value.length < 6) return err('Password needs 6+ characters.');
    if (!v('code')) return err('Enter the college access code.');
    if (!f.ok.checked) return err('Tick the box to continue.');
    const btn = $('#sub'); btn.disabled = true;
    try {
      const r = await api('/signup', { method: 'POST', quiet: true, body: {
        code: v('code'), userId: v('userId'), name: v('name'), dob: f.dob.value, gender: f.gender.value,
        interest, bio: v('bio'), password: f.password.value, photo } });
      startSession(r);
    } catch (x) { err(x.message); btn.disabled = false; }
  });
}

/* =====================================================
   log in
===================================================== */
function viewLogin() {
  app.innerHTML = `
    <main class="wrap formwrap">
      <button class="back" id="back">‹ Back</button>
      <h1 class="h">Welcome back</h1>
      <form class="card glass" id="f" novalidate>
        <label class="f">User ID<input type="text" name="userId" autocapitalize="none" autocomplete="username"></label>
        <label class="f">Password<input type="password" name="password" autocomplete="current-password"></label>
        <div class="err" id="err" role="alert"></div>
        <button class="btn" id="sub">Log in</button>
      </form>
    </main>`;
  $('#back').addEventListener('click', viewGate);
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, btn = $('#sub'); btn.disabled = true; $('#err').textContent = '';
    try { startSession(await api('/login', { method: 'POST', quiet: true, body: { userId: f.userId.value, password: f.password.value } })); }
    catch (x) { $('#err').textContent = x.message; btn.disabled = false; }
  });
}

/* =====================================================
   app shell
===================================================== */
let lastMatchCount = null;
function viewApp(tab) {
  stopTimers();
  app.innerHTML = `
    <div class="shell">
      <header class="top"><div class="logo">mpc <b>party night</b></div><div class="when">${esc(CFG.party.tagline)}</div></header>
      <main id="screen"></main>
    </div>
    <nav class="nav" aria-label="Main">
      <button data-tab="discover">${ICON.heart}Discover</button>
      <button data-tab="matches">${ICON.chat}Matches<span class="badge" id="badge" hidden></span></button>
      <button data-tab="me">${ICON.user}Me</button>
    </nav>`;
  document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  go(tab || 'discover');
  refreshBadge();
  timers.badge = setInterval(refreshBadge, 10000);
}
function go(tab) {
  curTab = tab; clearInterval(timers.m);
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'discover') screenDiscover();
  else if (tab === 'matches') screenMatches();
  else screenMe();
}
async function refreshBadge() {
  try {
    const d = await api('/matches');
    const un = d.matches.reduce((s, m) => s + m.unread, 0), b = $('#badge');
    if (b) { b.hidden = !un; b.textContent = un; }
    if (lastMatchCount !== null && d.matches.length > lastMatchCount && curTab !== 'matches') toast('You have a new match 🔥');
    lastMatchCount = d.matches.length;
  } catch (e) {}
}

/* =====================================================
   discover (swipe)
===================================================== */
let deck = [], loadingDeck = false, busy = false;
const seen = new Set();

async function loadDeck() {
  if (loadingDeck) return; loadingDeck = true;
  try {
    const d = await api('/deck');
    d.people.forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); deck.push(p); } });
  } catch (e) { toast(e.message); }
  loadingDeck = false;
}

function cardHTML(p, i) {
  return `<article class="pcard" data-pos="${i}" data-id="${esc(p.id)}" style="--i:${i}">
    <img src="${esc(p.photo)}" alt="Photo of ${esc(p.name)}" draggable="false">
    <div class="shade"></div>
    <div class="stamp yes">vibe</div><div class="stamp no">pass</div>
    <div class="info"><h2>${esc(p.name)} <small>${esc(p.age)}</small></h2>
      <div class="uid">@${esc(p.id)}</div>${p.bio ? `<p>${esc(p.bio)}</p>` : ''}</div>
  </article>`;
}

async function screenDiscover() {
  $('#screen').innerHTML = `
    <div id="deck"></div>
    <div class="actions">
      <button class="round no" id="nope" aria-label="Pass">${ICON.x}</button>
      <button class="round yes" id="like" aria-label="Like">${ICON.heart}</button>
    </div>
    <p class="hint">drag the card, or tap a button</p>`;
  $('#nope').addEventListener('click', () => buttonSwipe(false));
  $('#like').addEventListener('click', () => buttonSwipe(true));
  $('#deck').innerHTML = '<div class="empty"><h3>finding people…</h3></div>';
  if (deck.length < 3) await loadDeck();
  syncCards();
}

function syncCards() {
  const box = $('#deck'); if (!box) return;
  if (!deck.length) {
    box.innerHTML = `<div class="empty"><h3>that’s everyone for now</h3><p class="muted">New people join all day. Check back soon.</p><button class="btn" id="again">Look again</button></div>`;
    $('#again').addEventListener('click', async () => { await loadDeck(); syncCards(); if (!deck.length) toast('No new people yet'); });
    return;
  }
  box.querySelectorAll('.empty').forEach((e) => e.remove());
  const want = deck.slice(0, 3), have = {};
  box.querySelectorAll('.pcard').forEach((e) => { have[e.dataset.id] = e; });
  Object.keys(have).forEach((id) => { if (!want.find((p) => p.id === id)) { have[id].remove(); delete have[id]; } });
  for (let i = want.length - 1; i >= 0; i--) {
    const p = want[i];
    if (!have[p.id]) { const t = document.createElement('div'); t.innerHTML = cardHTML(p, i); have[p.id] = t.firstElementChild; }
    box.appendChild(have[p.id]);
    have[p.id].dataset.pos = i; have[p.id].style.setProperty('--i', i);
  }
  attachDrag(have[want[0].id]);
}

function attachDrag(el) {
  if (el._drag) return; el._drag = true;
  let sx = 0, sy = 0, dx = 0, on = false;
  const yes = el.querySelector('.stamp.yes'), no = el.querySelector('.stamp.no');
  el.addEventListener('pointerdown', (e) => {
    if (busy) return; on = true; sx = e.clientX; sy = e.clientY; dx = 0;
    el.setPointerCapture(e.pointerId); el.style.transition = 'none';
  });
  el.addEventListener('pointermove', (e) => {
    if (!on) return; dx = e.clientX - sx;
    el.style.transform = `translate(${dx}px,${(e.clientY - sy) * 0.3}px) rotate(${dx / 18}deg)`;
    const p = Math.min(Math.abs(dx) / 110, 1);
    yes.style.opacity = dx > 0 ? p : 0; no.style.opacity = dx < 0 ? p : 0;
  });
  const end = () => {
    if (!on) return; on = false;
    if (Math.abs(dx) > 110) fling(el, dx > 0);
    else { el.style.transition = ''; el.style.transform = ''; yes.style.opacity = 0; no.style.opacity = 0; }
    dx = 0;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function buttonSwipe(like) {
  const el = $('#deck .pcard[data-pos="0"]'); if (!el || busy) return;
  el.querySelector(like ? '.stamp.yes' : '.stamp.no').style.opacity = 1;
  fling(el, like);
}

function fling(el, like) {
  if (busy) return; busy = true;
  const id = el.dataset.id;
  el.style.transition = 'transform .45s ease, opacity .45s';
  el.style.transform = `translate(${like ? 620 : -620}px,-40px) rotate(${like ? 30 : -30}deg)`;
  el.style.opacity = '0';
  api('/swipe', { method: 'POST', body: { to: id, like } })
    .then((r) => { if (r.match) showMatch(r.user); })
    .catch((e) => toast(e.message));
  setTimeout(() => {
    el.remove(); deck.shift(); busy = false; syncCards();
    if (deck.length < 4) loadDeck().then(syncCards);
  }, 380);
}

function showMatch(u) {
  if (lastMatchCount !== null) lastMatchCount++;
  const o = document.createElement('div');
  o.className = 'match'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', 'New match');
  o.innerHTML = `<div class="match-in">
    <div class="mt">it’s a match</div>
    <div class="pair"><img src="${esc(me.photo)}" alt="You"><img src="${esc(u.photo)}" alt="${esc(u.name)}"></div>
    <p>You and ${esc(u.name)} both said yes. Say something before someone else does.</p>
    <button class="btn light" id="m-chat">Say hi</button>
    <button class="btn ghost" id="m-keep" style="color:#fff;box-shadow:inset 0 0 0 1.5px #fff">Keep swiping</button></div>`;
  document.body.append(o);
  $('#m-keep').addEventListener('click', () => o.remove());
  $('#m-chat').addEventListener('click', () => { o.remove(); viewChat(u.id); });
  $('#m-chat').focus();
}

/* =====================================================
   matches list
===================================================== */
async function screenMatches() {
  $('#screen').innerHTML = `<h1 class="h">Your matches</h1><div id="mlist"></div>`;
  const draw = async () => {
    if (curTab !== 'matches') return;
    try {
      const d = await api('/matches'), box = $('#mlist'); if (!box) return;
      lastMatchCount = d.matches.length;
      if (!d.matches.length) {
        box.innerHTML = `<div class="note"><h3>No matches yet</h3><p class="muted">Keep swiping. When you both like each other, they show up here.</p></div>`;
        return;
      }
      box.innerHTML = d.matches.map((m) => `
        <button class="mrow ${m.last ? '' : 'new'}" data-id="${esc(m.user.id)}">
          <img src="${esc(m.user.photo)}" alt="">
          <div><b>${esc(m.user.name)}</b><span>${m.last ? (m.last.mine ? 'You: ' : '') + esc(m.last.text) : 'New match. Say hi 👋'}</span></div>
          ${m.unread ? `<i class="dot">${m.unread}</i>` : ''}
        </button>`).join('');
      box.querySelectorAll('.mrow').forEach((b) => b.addEventListener('click', () => viewChat(b.dataset.id)));
    } catch (e) {}
  };
  await draw();
  timers.m = setInterval(draw, 6000);
}

/* =====================================================
   chat
===================================================== */
function viewChat(id) {
  stopTimers();
  let last = 0, other = null, first = true;
  app.innerHTML = `
    <div class="chat">
      <header class="chead">
        <button class="icon" id="cb" aria-label="Back">‹</button>
        <img id="cimg" alt="" hidden>
        <div><b id="cname">…</b><span id="cid"></span></div>
        <button class="icon" id="cmore" aria-label="Report or block">⋯</button>
      </header>
      <div class="msgs" id="msgs" aria-live="polite"></div>
      <form class="composer" id="cf" autocomplete="off">
        <input id="ct" maxlength="500" placeholder="say something…" aria-label="Message">
        <button class="send" aria-label="Send">${ICON.send}</button>
      </form>
    </div>`;
  const box = $('#msgs');
  const leave = () => { stopTimers(); viewApp('matches'); refreshBadge(); };
  $('#cb').addEventListener('click', leave);

  async function pull() {
    if (document.hidden && !first) return;
    try {
      const d = await api('/chat/' + encodeURIComponent(id) + '?after=' + last);
      if (!other) {
        other = d.other;
        $('#cname').textContent = other.name + ', ' + other.age;
        $('#cid').textContent = '@' + other.id;
        const im = $('#cimg'); im.src = other.photo; im.alt = other.name; im.hidden = false;
      }
      if (first && !d.messages.length) {
        box.innerHTML = `<div class="starter"><b>you matched 🎉</b>Break the ice. Plan the night.</div>`;
      }
      if (d.messages.length) {
        const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120 || first;
        box.querySelector('.starter')?.remove();
        d.messages.forEach((m) => {
          last = Math.max(last, m.n);
          const el = document.createElement('div');
          el.className = 'b ' + (m.mine ? 'me' : 'them');
          el.textContent = m.text;
          const t = document.createElement('time');
          t.textContent = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          el.append(t); box.append(el);
        });
        if (nearBottom) box.scrollTop = box.scrollHeight;
      }
      first = false;
    } catch (e) {
      if (first) { toast(e.message); leave(); }
    }
  }
  pull();
  timers.chat = setInterval(pull, 2500);

  $('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#ct'), text = inp.value.trim(); if (!text) return;
    inp.value = '';
    try { await api('/chat/' + encodeURIComponent(id), { method: 'POST', body: { text } }); first = false; pull(); }
    catch (x) { toast(x.message); inp.value = text; }
  });

  $('#cmore').addEventListener('click', async () => {
    if (!other) return;
    if (!confirm('Report and block ' + other.name + '? You won’t see each other again.')) return;
    const reason = prompt('What happened? (optional)') || '';
    try { await api('/report', { method: 'POST', body: { id, reason } }); toast('Reported and blocked'); leave(); }
    catch (x) { toast(x.message); }
  });
}

/* =====================================================
   me
===================================================== */
function screenMe() {
  $('#screen').innerHTML = `
    <div class="glass me-card">
      <img src="${esc(me.photo)}" alt="Your photo">
      <h2>${esc(me.name)}, ${esc(me.age)}</h2>
      <p class="muted">@${esc(me.id)}</p>
      ${me.bio ? `<p>${esc(me.bio)}</p>` : ''}
    </div>
    <div class="stack" style="margin-top:18px">
      <button class="btn ghost" id="lo">Log out</button>
      <button class="danger" id="del">Delete my account</button>
    </div>`;
  $('#lo').addEventListener('click', async () => { try { await api('/logout', { method: 'POST' }); } catch (e) {} endSession(); });
  $('#del').addEventListener('click', async () => {
    if (!confirm('Delete your profile, matches and chats for good?')) return;
    try { await api('/me', { method: 'DELETE' }); toast('Account deleted'); endSession(); } catch (e) { toast(e.message); }
  });
}

/* =====================================================
   boot
===================================================== */
(async function boot() {
  try { CFG = await (await fetch('/api/config')).json(); }
  catch (e) { app.innerHTML = '<p style="padding:30px">Can’t reach the server. Is it running?</p>'; return; }
  if (token) {
    try { me = (await api('/me')).me; viewApp('discover'); return; } catch (e) {}
  }
  viewGate();
})();
