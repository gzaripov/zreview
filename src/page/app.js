(() => {
  const data = JSON.parse(document.getElementById('review-data').textContent);
  marked.setOptions({ mangle: false, headerIds: false });
  const LAYERED = 'purpose' in data;
  const ABSENT = LAYERED && !!data.purpose.absent;
  const LEVELS = !LAYERED ? [] : [
    { id: '@high', key: 'H', name: 'High', title: 'Why this exists', ask: 'Is this the right thing to build, and are its limits right?' },
    { id: '@mid', key: 'M', name: 'Mid', title: 'What the product does', ask: 'Is this how the product should work? Is anything missing, or here though nobody asked for it?' },
    { id: '@low', key: 'L', name: 'Low', title: 'How it behaves and is built', ask: 'Would a tester sign this off? Is every rule checked, and does every case check a rule?' },
  ].filter(l => !(ABSENT && l.id === '@high'));
  const CODE = '@code';

  let monacoApi = null; const editors = new Map();   // Monaco, once its CDN load resolves; see below

  // ---- theme: data-theme on <html> is set before paint by a head script; here the toggle, and mermaid follows it
  const root = document.documentElement, themeBtn = document.getElementById('theme');
  const DIAGRAM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  const DIAGRAM_COLORS = {
    light: {
      background: '#ffffff', primaryColor: '#ffffff', primaryTextColor: '#1f2328', primaryBorderColor: '#656d76', lineColor: '#656d76', textColor: '#1f2328',
      secondaryColor: '#f6f8fa', secondaryBorderColor: '#d0d7de', secondaryTextColor: '#1f2328', tertiaryColor: '#f6f8fa', tertiaryBorderColor: '#d0d7de', tertiaryTextColor: '#1f2328',
      mainBkg: '#ffffff', nodeBorder: '#656d76', clusterBkg: '#f6f8fa', clusterBorder: '#d0d7de', titleColor: '#1f2328', edgeLabelBackground: '#ffffff',
      noteBkgColor: '#fff1a8', noteTextColor: '#1f2328', noteBorderColor: '#d4a72c',
      actorBkg: '#ffffff', actorBorder: '#656d76', actorTextColor: '#1f2328', actorLineColor: '#8c959f', signalColor: '#1f2328', signalTextColor: '#1f2328',
      labelBoxBkgColor: '#f6f8fa', labelBoxBorderColor: '#d0d7de', labelTextColor: '#1f2328', loopTextColor: '#1f2328',
      activationBkgColor: '#f6f8fa', activationBorderColor: '#656d76', sequenceNumberColor: '#ffffff',
    },
    dark: {
      darkMode: true, background: '#0d1117', primaryColor: '#0d1117', primaryTextColor: '#e6edf3', primaryBorderColor: '#8b949e', lineColor: '#8b949e', textColor: '#e6edf3',
      secondaryColor: '#161b22', secondaryBorderColor: '#30363d', secondaryTextColor: '#e6edf3', tertiaryColor: '#161b22', tertiaryBorderColor: '#30363d', tertiaryTextColor: '#e6edf3',
      mainBkg: '#0d1117', nodeBorder: '#8b949e', clusterBkg: '#161b22', clusterBorder: '#30363d', titleColor: '#e6edf3', edgeLabelBackground: '#0d1117',
      noteBkgColor: '#4a3d07', noteTextColor: '#e6edf3', noteBorderColor: '#d29922',
      actorBkg: '#0d1117', actorBorder: '#8b949e', actorTextColor: '#e6edf3', actorLineColor: '#6e7681', signalColor: '#e6edf3', signalTextColor: '#e6edf3',
      labelBoxBkgColor: '#161b22', labelBoxBorderColor: '#30363d', labelTextColor: '#e6edf3', loopTextColor: '#e6edf3',
      activationBkgColor: '#161b22', activationBorderColor: '#8b949e', sequenceNumberColor: '#0d1117',
    },
  };
  const glyph = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const MOON = glyph('<path d="M13.4 9.7A5.7 5.7 0 0 1 6.3 2.6a5.7 5.7 0 1 0 7.1 7.1z"/>');
  const SUN = glyph('<circle cx="8" cy="8" r="2.9"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>');
  let themeTurn = 0;
  const applyTheme = (t, persist) => {
    root.dataset.theme = t;
    themeTurn++;
    if (persist) localStorage.setItem('zreview:theme', t);
    themeBtn.innerHTML = t === 'dark' ? SUN : MOON;
    themeBtn.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    themeBtn.setAttribute('aria-label', themeBtn.title);
    mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: { fontFamily: DIAGRAM_FONT, fontSize: '14px', ...DIAGRAM_COLORS[t === 'dark' ? 'dark' : 'light'] }, securityLevel: 'strict' });
    if (monacoApi) monacoApi.editor.setTheme(t === 'dark' ? 'zreview-dark' : 'zreview-light');
  };
  applyTheme(root.dataset.theme, false);
  themeBtn.onclick = () => { applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true); render(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { if (!localStorage.getItem('zreview:theme')) { applyTheme(e.matches ? 'dark' : 'light', false); render(); } });
  const faceBtn = document.getElementById('face');
  const applyFace = (face, persist) => {
    root.dataset.face = face;
    if (persist) localStorage.setItem('zreview:face', face);
    faceBtn.title = face === 'sans' ? 'Statements are set in the system sans. Switch to Charter (F)' : 'Statements are set in Charter. Switch to the system sans (F)';
  };
  const toggleFace = () => {
    const row = [...document.querySelectorAll('.d4-cl, .d4-s > h2, .file')].find(el => el.getBoundingClientRect().bottom > 12), top = row?.getBoundingClientRect().top;
    applyFace(root.dataset.face === 'sans' ? 'serif' : 'sans', true);
    if (row) scrollBy(0, row.getBoundingClientRect().top - top);
  };
  applyFace(localStorage.getItem('zreview:face') === 'sans' ? 'sans' : 'serif', false);
  faceBtn.onclick = toggleFace;

  // ---- state: { [featureId]: { decision, note, at, head, files: {path: hash}, viewed: {path: hash}, comments: [{ id, kind, file, side, line, section, quote, body, at }] } }
  // Served: the server hands the saved state in and takes every change back (the port changes per run, so
  // browser storage cannot carry it). Static: browser storage, keyed by PR so a new head keeps the state.
  const key = `zreview:${data.pr.repo}#${data.pr.number}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
  const save = () => {
    forgetSince();
    localStorage.setItem(key, JSON.stringify(state));
    if (SERVED) fetch('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state), keepalive: true }).catch(() => {});
  };
  let state = SERVED ? (INITIAL_STATE || {}) : load();
  let submitted = false;
  const delBtn = (c) => submitted ? '' : `<button type="button" data-del="${c.id}">delete</button>`;
  let showDiff = true;                         // reworked prose shows what it said beside what it says
  let current = location.hash.slice(1) || (LAYERED ? LEVELS[0].id : data.features[0] && data.features[0].id);
  let shownId = null;
  const expanded = {};                         // featureId -> Map of file path -> open, where the reviewer toggled it
  const entry = (id) => (state[id] ||= { comments: [] }, state[id].comments ||= [], state[id]);
  const uid = () => Math.random().toString(36).slice(2, 10);

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = (s) => s ? marked.parse(s) : '';
  const inl = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  const main = document.getElementById('main');
  const drawn = new Map(), drawing = new Set();
  let drawCount = 0;
  const drawKey = (source) => `${root.dataset.theme}\n${source}`;
  const figureBody = (hit) => !hit ? '' : hit.svg
    ? `<button class="fs" type="button" title="Full screen" aria-label="Show the diagram full screen">⛶</button>${hit.svg}`
    : `<p class="none">Diagram failed to render: ${esc(hit.error)}</p>`;
  const figure = (d) => {
    const hit = drawn.get(drawKey(d.mermaid));
    return `<figure class="fig"><div class="diagram${hit ? '' : ' pending'}" data-source="${esc(d.mermaid)}">${figureBody(hit)}</div>${d.title ? `<figcaption>${esc(d.title)}</figcaption>` : ''}</figure>`;
  };
  function draw(source) {
    const key = drawKey(source);
    if (drawn.has(key) || drawing.has(key)) return;
    const id = `mmd-${++drawCount}`, turn = themeTurn;
    drawing.add(key);
    mermaid.render(id, source).then(r => ({ svg: r.svg }), e => { document.getElementById(`d${id}`)?.remove(); return { error: e.message }; }).then(hit => {
      drawing.delete(key);
      if (turn !== themeTurn) return drawFigures();
      drawn.set(key, hit);
      const held = [...main.querySelectorAll('.d4-cl.cur, .d4-s > h2, .file')].find(el => el.getBoundingClientRect().bottom > 0), top = held?.getBoundingClientRect().top;
      for (const box of main.querySelectorAll('.diagram.pending')) {
        if (drawKey(box.dataset.source) !== key) continue;
        box.classList.remove('pending'); box.innerHTML = figureBody(hit);
      }
      if (held?.isConnected) scrollBy(0, held.getBoundingClientRect().top - top);
    });
  }
  function drawFigures() { main.querySelectorAll('.diagram.pending').forEach(box => draw(box.dataset.source)); }
  const drawAhead = () => (window.requestIdleCallback || setTimeout)(() => data.features.forEach(f => (f.diagrams || []).forEach(d => draw(d.mermaid))));
  const items = new Map();
  if (LAYERED) {
    for (const g of data.purpose.goals || []) items.set(g.id, { level: '@high', kind: 'goal', text: g.text });
    for (const g of data.purpose.nonGoals || []) items.set(g.id, { level: '@high', kind: 'non-goal', text: g.text });
    for (const f of data.features) {
      items.set(f.id, { level: '@mid', kind: 'feature', text: f.title });
      for (const r of f.rules || []) items.set(r.id, { level: '@mid', kind: 'rule', text: r.text });
      for (const b of f.behaviours || []) items.set(b.id, { level: '@low', kind: 'behaviour', text: b.title });
    }
  }

  document.getElementById('pr-title').textContent = data.pr.title;
  const PLAN = !!data.plan;
  const codeName = PLAN ? 'Plan' : 'Code';
  const HEAD_AND_BASE = [data.pr.head && `at ${data.pr.head}`, data.pr.base && `into ${data.pr.base}`].filter(Boolean).join(', ');
  document.getElementById('pr-meta').innerHTML = PLAN
    ? `Plan for ${esc(data.pr.repo)}, not built yet`
    : `<a href="${esc(data.pr.url)}" title="${esc(HEAD_AND_BASE)}">${esc(data.pr.repo)}#${data.pr.number}</a>`;
  const reach = document.getElementById('pr-exposure'), more = document.getElementById('pr-more');
  reach.innerHTML = LAYERED && !ABSENT ? '' : inl(data.pr.exposure || '');
  const fitReach = () => { more.hidden = !reach.classList.contains('open') && reach.scrollHeight <= reach.clientHeight + 1; };
  more.onclick = () => { more.textContent = reach.classList.toggle('open') ? 'Show less' : 'Show all'; };
  addEventListener('resize', fitReach);
  fitReach();
  if (SERVED) document.getElementById('submit').hidden = false;
  if (PLAN) document.getElementById('submit').textContent = 'Submit plan review';

  // ---- sidebar
  const decisionBadge = (s, moved) => moved ? 'updated' : s.decision === 'approved' ? 'approved' : s.decision === 'changes' ? 'changes' : 'open';
  const badgeLabel = (b) => b === 'changes' ? 'changes requested' : b;
  const navBox = (b) => `<span class="nb ${{ approved: 'ok', changes: 'change', updated: 'moved' }[b] || ''}">${{ approved: '✓', changes: '✕', updated: '!' }[b] || ''}</span>`;
  const navWord = (b, title) => b === 'open' ? '' : `<span class="badge ${b}"${title ? ` title="${esc(title)}"` : ''}>${badgeLabel(b)}</span>`;
  const side = document.querySelector('.side');
  const navOpen = (nav) => {
    nav.querySelectorAll('button').forEach(b => b.onclick = () => { current = b.dataset.id; location.hash = current; render(); });
    const on = nav.querySelector('button.active');
    if (!on || side.scrollHeight <= side.clientHeight) return;
    const a = on.getBoundingClientRect(), b = side.getBoundingClientRect();
    if (a.top < b.top) side.scrollTop -= b.top - a.top + 8;
    else if (a.bottom > b.bottom) side.scrollTop += a.bottom - b.bottom + 8;
  };
  function navCode(f, i) {
    const s = state[f.id] || {}, n = (s.comments || []).length, v = viewedCount(f), upd = changedSince(f).length;
    const b = decisionBadge(s, upd);
    return `<button data-id="${esc(f.id)}" class="code ${f.id === current ? 'active' : ''}">
      ${navBox(b)}<span class="body"><span class="t"><span class="id">${i + 1}</span>${esc(f.title)}</span>
      <span class="meta">${v.total ? `<span class="v ${v.seen === v.total ? 'all' : ''}">${v.seen} of ${v.total} viewed</span>` : ''}${n ? `<span class="c">${plural(n, 'comment')}</span>` : ''}${navWord(b, upd ? `${plural(upd, 'file')} changed since your decision` : '')}</span></span></button>`;
  }
  function navAll() {
    const fs = data.features, st = fs.map(f => state[f.id] || {}), counts = fs.map(viewedCount);
    const total = counts.reduce((n, v) => n + v.total, 0), seen = counts.reduce((n, v) => n + v.seen, 0);
    const n = st.reduce((sum, s) => sum + (s.comments || []).length, 0), done = st.filter(s => s.decision).length;
    const moved = fs.filter(f => state[f.id]?.decision && changedSince(f).length).length;
    const b = moved ? 'updated' : st.some(s => s.decision === 'changes') ? 'changes' : st.every(s => s.decision === 'approved') ? 'approved' : 'open';
    return `<button data-id="${CODE}" class="lv ${current === CODE ? 'active' : ''}">
      ${navBox(b)}<span class="body"><span class="t">${codeName}</span>
      <span class="meta"><span class="cnt">${total ? `${seen} of ${total} viewed` : `${done} of ${fs.length} decided`}</span>${n ? `<span class="c">${plural(n, 'comment')}</span>` : ''}${navWord(b, moved ? `${plural(moved, 'feature')} changed since your decision` : '')}</span></span></button>`;
  }
  function renderLevelNav(nav) {
    const levels = LEVELS.map(l => {
      const s = state[l.id] || {}, b = decisionBadge(s, levelMoved(l.id)), n = (s.comments || []).length, t = tallyOf(l.id);
      return `<button data-id="${l.id}" class="lv ${l.id === current ? 'active' : ''}" title="${esc(l.title)}">
        ${navBox(b)}<span class="body"><span class="t">${l.name}</span>
        <span class="meta"><span class="cnt">${t.n - t.open} of ${t.n} read</span>${n ? `<span class="c">${plural(n, 'comment')}</span>` : ''}${navWord(b)}</span></span></button>`;
    }).join('');
    nav.innerHTML = `${ABSENT ? `<div class="navnote"><b>High</b>: none. ${esc(data.purpose.absent)}</div>` : ''}${levels}${data.features.length ? navAll() : ''}`;
    navOpen(nav);
    const a = LEVELS.filter(l => state[l.id]?.decision === 'approved').length, c = LEVELS.filter(l => state[l.id]?.decision === 'changes').length;
    const below = data.features.some(f => state[f.id]?.decision === 'changes');
    document.getElementById('tally').textContent = `${a} of ${LEVELS.length} levels approved${c ? `, ${c} with changes requested` : ''}${below ? `, changes requested in the ${codeName.toLowerCase()}` : ''}`;
  }
  function renderNav() {
    const nav = document.getElementById('nav');
    if (LAYERED) return renderLevelNav(nav);
    nav.innerHTML = data.features.map(navCode).join('');
    navOpen(nav);
    const total = data.features.length, a = data.features.filter(f => state[f.id]?.decision === 'approved').length,
          c = data.features.filter(f => state[f.id]?.decision === 'changes').length;
    document.getElementById('tally').textContent = `${a} of ${total} approved${c ? `, ${c} with changes requested` : ''}`;
  }

  // ---- revisions: what the reviewer had in front of them last time. Taken when they decide on a
  // feature and, per file, when they mark it viewed. Everything a reviewer reads is in it — the prose,
  // the entities, the diagrams and the diff itself — so the next run can show what the author moved
  // rather than only that something moved.
  const LINE_CAP = 4000;                            // beyond this a file keeps its hash but not its lines
  const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  const owned = new Map();
  data.features.forEach((f, i) => (f.files || []).forEach(file => {
    if (!file.own) return;
    if (!owned.has(file.path)) owned.set(file.path, { new: new Map(), old: new Map() });
    const o = owned.get(file.path);
    for (const side of ['new', 'old']) for (const n of file.own[side]) o[side].set(n, [...(o[side].get(n) || []), i]);
  }));
  const shares = new WeakMap();
  function shareOf(file) {
    if (!file.own || !file.hunks) return null;
    if (shares.has(file)) return shares.get(file);
    const mine = { new: new Set(file.own.new), old: new Set(file.own.old) }, all = owned.get(file.path);
    const sideOf = (l) => l.t === '+' ? 'new' : 'old', numOf = (l) => l.t === '+' ? l.new : l.old;
    const self = data.features.findIndex(f => (f.files || []).includes(file));
    const others = [...new Set([...all.new.values(), ...all.old.values()].flat())].filter(i => i !== self).sort((a, b) => a - b);
    const ownersAt = (side, n) => all[side].get(n) || [];
    const aloneAt = (side, n) => mine[side].has(n) && ownersAt(side, n).length === 1;
    const sh = {
      mine, others, self, add: mine.new.size, del: mine.old.size,
      owns: (l) => l.t !== ' ' && mine[sideOf(l)].has(numOf(l)),
      owners: (l) => l.t === ' ' ? [] : ownersAt(sideOf(l), numOf(l)),
      alone: (l) => l.t !== ' ' && aloneAt(sideOf(l), numOf(l)),
      span: (side, u) => { const out = new Set(); for (let n = u.from; n <= u.to; n++) ownersAt(side, n).forEach(i => i !== self && out.add(i)); return out; },
      touches: (side, u) => { for (let n = u.from; n <= u.to; n++) if (mine[side].has(n)) return true; return false; },
      touchesAlone: (side, u) => { for (let n = u.from; n <= u.to; n++) if (aloneAt(side, n)) return true; return false; },
    };
    sh.exAdd = [...mine.new].filter(n => aloneAt('new', n)).length;
    sh.exDel = [...mine.old].filter(n => aloneAt('old', n)).length;
    sh.hasAlone = sh.exAdd + sh.exDel > 0;
    sh.main = (l) => sh.hasAlone ? sh.alone(l) : sh.owns(l);
    shares.set(file, sh);
    return sh;
  }
  const lineKind = (sh, l) => !sh || l.t === ' ' ? '' : !sh.owns(l) ? 'foreign' : sh.alone(l) ? 'mine' : 'shared';
  const featureName = (i) => `${i + 1}. ${data.features[i].title}`;
  const ownerNames = (list) => [...list].sort((a, b) => a - b).map(featureName).join(' · ');
  const ownerRefs = (list) => [...list].sort((a, b) => a - b).map(i => i + 1).join(', ');
  const ownerTag = (list, also = false) => `<span class="whose${also ? ' also' : ''}" title="${esc(`${also ? 'Also claimed by' : 'Belongs to'} ${ownerNames(list)}`)}">${also ? 'also ' : ''}${[...list].sort((a, b) => a - b).map(i => i + 1).join('·')}</span>`;

  const perFile = (fn) => { const known = new WeakMap(); return (file) => { if (!known.has(file)) known.set(file, fn(file)); return known.get(file); }; };
  const wholeHash = perFile((file) => file.hunks ? hashStr(JSON.stringify(file.hunks)) : null);
  const flatLines = (file) => { const sh = shareOf(file); return file.hunks ? file.hunks.flatMap(h => h.lines.filter(l => !sh || sh.owns(l)).map(l => l.t + l.text)) : null; };
  const fhash = perFile((file) => shareOf(file) ? hashStr(JSON.stringify(flatLines(file))) : wholeHash(file));
  const fileShot = (file) => { const lines = flatLines(file); return { h: fhash(file), lines: lines && lines.length <= LINE_CAP ? lines : null, ...(shareOf(file) ? { own: true } : {}) }; };
  const textOf = (f) => ({ scenario: f.scenario || '', description: f.description || '', tested: f.tested || '' });
  const entityShots = (f) => Object.fromEntries((f.entities || []).map(e => [e.name, hashStr(JSON.stringify(e))]));
  const shot = (f) => ({
    at: Date.now(), head: data.pr.head || 'plan', text: textOf(f), entities: entityShots(f),
    diagrams: hashStr(JSON.stringify(f.diagrams || [])),
    files: Object.fromEntries((f.files || []).map(file => [file.path, fileShot(file)])),
  });
  const seenOf = (f) => entry(f.id).seen;
  const isViewed = (f, file) => {
    const v = entry(f.id).viewed ||= {};
    if (!(file.path in v)) return false;
    if (v[file.path] === fhash(file)) return true;
    if (!shareOf(file)) return false;
    const was = seenOf(f)?.files?.[file.path];
    return v[file.path] === wholeHash(file) || (!!was && !was.own && v[file.path] === was.h && !(file.path in sinceOf(f).files));
  };
  const viewedCount = (f) => { const files = f.files || []; return { seen: files.filter(x => isViewed(f, x)).length, total: files.length }; };
  function toggleViewed(f, file, on = !isViewed(f, file)) {
    const e = entry(f.id), v = e.viewed ||= {};
    if (on) {
      v[file.path] = fhash(file);
      // Viewing one file is a look at that file, so only its snapshot moves forward.
      const s = e.seen ||= { at: Date.now(), head: data.pr.head || 'plan', files: {} };
      (s.files ||= {})[file.path] = fileShot(file);
    } else delete v[file.path];
    expanded[f.id]?.delete(file.path);              // like GitHub: a viewed file folds
    save(); render(); renderFocus();
  }

  /** Lines of `now` the reviewer has not seen. Order-insensitive, so code that only moved is not "new". */
  function freshLines(now, before) {
    if (!now) return null;
    if (!before) return now.map(() => false);
    const left = new Map();
    for (const l of before) left.set(l, (left.get(l) || 0) + 1);
    const fresh = now.map(l => { const n = left.get(l) || 0; if (n) { left.set(l, n - 1); return false; } return true; });
    let gone = 0; for (const n of left.values()) gone += n;
    fresh.gone = gone;
    return fresh;
  }
  /** Everything that moved since the reviewer's snapshot, keyed the way the panel needs it. */
  function since(f) {
    const s = seenOf(f);
    const out = { any: false, at: s?.at, head: s?.head, text: {}, entities: new Set(), diagrams: false, files: {} };
    if (!s) return out;
    if (s.text) for (const k of ['scenario', 'description', 'tested']) {
      if ((s.text[k] ?? '') !== (textOf(f)[k] ?? '')) { out.text[k] = s.text[k] ?? ''; out.any = true; }
    }
    if (s.entities) for (const [name, h] of Object.entries(entityShots(f))) {
      if (s.entities[name] !== undefined && s.entities[name] !== h) { out.entities.add(name); out.any = true; }
    }
    if (s.diagrams !== undefined && s.diagrams !== hashStr(JSON.stringify(f.diagrams || []))) { out.diagrams = true; out.any = true; }
    out.newFiles = s.files ? (f.files || []).filter(x => !(x.path in s.files)).map(x => x.path) : [];
    if (out.newFiles.length) out.any = true;
    for (const file of f.files || []) {
      const was = s.files?.[file.path];
      if (!was || was.h === fhash(file)) continue;
      const wholeShot = !!shareOf(file) && !was.own;
      if (wholeShot && was.h === wholeHash(file)) continue;
      const fresh = freshLines(flatLines(file), was.lines);
      if (wholeShot && fresh && was.lines && !fresh.some(Boolean)) continue;
      out.files[file.path] = { fresh, added: fresh ? fresh.filter(Boolean).length : null, gone: fresh && !wholeShot ? fresh.gone : null };
      out.any = true;
    }
    return out;
  }
  const sinceMemo = new Map();
  const sinceOf = (f) => { if (!sinceMemo.has(f.id)) sinceMemo.set(f.id, since(f)); return sinceMemo.get(f.id); };
  const forgetSince = () => sinceMemo.clear();
  /** Paths whose hunks differ from what the reviewer last saw. */
  const changedSince = (f) => Object.keys(sinceOf(f).files).sort();

  // ---- word-level diff for the prose blocks, so "what changed" shows what changed
  function lcsOps(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = []; let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) ops.push(['same', i++, j++]);
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['del', i++, -1]);
      else ops.push(['ins', -1, j++]);
    }
    while (i < m) ops.push(['del', i++, -1]);
    while (j < n) ops.push(['ins', -1, j++]);
    return ops;
  }
  function wordDiff(before, after) {
    const tok = (s) => s.split(/(\s+)/).filter(x => x !== '');
    const a = tok(before), b = tok(after);
    if (a.length + b.length > 2400) return null;               // too long to diff cheaply; show the text plain
    const out = [];
    const push = (kind, text) => { const last = out[out.length - 1]; last && last.kind === kind ? last.text += text : out.push({ kind, text }); };
    for (const [kind, i, j] of lcsOps(a, b)) push(kind, kind === 'del' ? a[i] : b[j]);
    return out;
  }

  // ---- blocks
  function shots(s, ofCase) {
    const pair = s.before_src && s.after_src;
    const fig = (label, src) => src ? `<figure>${ofCase && !pair ? '' : `<div class="label">${label}</div>`}<img src="${src}" alt="${ofCase && !pair ? esc(s.caption || 'Screenshot') : label}"></figure>` : '';
    return `<div class="shots${pair ? '' : ' one'}">${fig('Before', s.before_src)}${fig('After', s.after_src)}</div>` + (s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : '');
  }

  const exampleShown = new Map();
  function entities(f) {
    const es = f.entities || [];
    if (!es.length) return `<p class="d4-none">No domain entity added or changed.</p>`;
    const change = (c, own) => c && c !== own ? `<i class="chg ${c}">${c}</i>` : '';
    const parts = (label, ps, own) => ps?.length ? `<div class="parts"><div class="plabel">${label}</div>
      ${ps.map(p => `<div class="part ${p.change || ''}"><div class="pname"><code>${esc(p.name)}</code>${p.type ? `<span class="ptype">${esc(p.type)}</span>` : ''}${change(p.change, own)}</div>
        <div class="pmeaning">${esc(p.meaning)}${p.why ? `<div class="pwhy">${esc(p.why)}</div>` : ''}</div></div>`).join('')}</div>` : '';
    const examplesOf = (e) => e.examples?.length ? e.examples : e.example !== undefined ? [{ title: 'Example', value: e.example }] : [];
    const examples = (e, i) => {
      const exs = examplesOf(e), on = Math.min(exampleShown.get(`${f.id}\n${i}`) || 0, exs.length - 1);
      if (!exs.length) return '';
      return `<div class="examples" data-entity="${i}">
        <div class="tabs">${exs.map((x, j) => `<button type="button" class="${j === on ? 'on' : ''}" data-ex="${j}">${esc(x.title || `Example ${j + 1}`)}</button>`).join('')}</div>
        ${exs.map((x, j) => `<div class="ex" data-ex="${j}" ${j === on ? '' : 'hidden'}>${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}<div class="editor"><pre><code>${esc(exampleText(x))}</code></pre></div></div>`).join('')}
      </div>`;
    };
    const moved = sinceOf(f).entities;
    return es.map((e, i) => `<div class="d4-row ent ${e.change || ''}">
      <div class="d4-main">
        <p class="eh"><code class="ename">${esc(e.name)}</code>${change(e.change)}${e.kind ? `<span class="ekind">${esc(e.kind)}</span>` : ''}${e.from ? `<span class="efrom">was <code>${esc(e.from)}</code></span>` : ''}</p>
        <div class="esum">${esc(e.summary)}${e.why ? `<div class="ewhy">${esc(e.why)}</div>` : ''}</div>
        ${parts('Consists of', e.fields, e.change)}${parts('What you can do', e.operations, e.change)}
      </div>
      <div class="d4-note">${moved.has(e.name) ? '<p class="call">Reworked since you looked.</p>' : ''}${e.file ? `<p class="efile">${esc(e.file)}</p>` : ''}${examples(e, i)}</div>
    </div>`).join('');
  }
  const exampleText = (x) => typeof x.value === 'string' ? x.value : JSON.stringify(x.value, null, 2);
  const exampleLang = (x) => x.lang || (typeof x.value === 'string' ? 'plaintext' : 'json');

  // ---- Monaco for examples: read-only, sized to content, themed with the page. Loaded from the CDN
  // after the page is up; until then (or without a network) the <pre> underneath stays.
  const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
  const monacoReady = new Promise((done) => {
    if (!window.require?.config) return done(null);
    window.MonacoEnvironment = { getWorkerUrl: () => URL.createObjectURL(new Blob(
      [`self.MonacoEnvironment={baseUrl:'${MONACO}/'};importScripts('${MONACO}/vs/base/worker/workerMain.js');`], { type: 'text/javascript' })) };
    require.config({ paths: { vs: `${MONACO}/vs` } });
    require(['vs/editor/editor.main'], () => {
      const m = window.monaco;
      const rules = (kw, key, str, num, cm) => [
        { token: 'keyword', foreground: kw }, { token: 'string.key.json', foreground: key }, { token: 'string.value.json', foreground: str },
        { token: 'string', foreground: str }, { token: 'number', foreground: num }, { token: 'comment', foreground: cm, fontStyle: 'italic' },
        { token: 'delimiter', foreground: cm }, { token: 'type', foreground: key }, { token: 'attribute.name', foreground: key }, { token: 'attribute.value', foreground: str },
      ];
      m.editor.defineTheme('zreview-light', { base: 'vs', inherit: true, rules: rules('cf222e', '0550ae', '0a3069', '0550ae', '6e7781'),
        colors: { 'editor.background': '#f6f8fa', 'editorLineNumber.foreground': '#8c959f', 'editorLineNumber.activeForeground': '#1f2328', 'editor.foreground': '#1f2328', 'editorGutter.background': '#f6f8fa', 'editorBracketHighlight.foreground1': '#0969da', 'editorBracketHighlight.foreground2': '#8250df', 'editorBracketHighlight.foreground3': '#bf3989' } });
      m.editor.defineTheme('zreview-dark', { base: 'vs-dark', inherit: true, rules: rules('ff7b72', '79c0ff', 'a5d6ff', '79c0ff', '8b949e'),
        colors: { 'editor.background': '#161b22', 'editorLineNumber.foreground': '#6e7681', 'editorLineNumber.activeForeground': '#e6edf3', 'editor.foreground': '#e6edf3', 'editorGutter.background': '#161b22', 'editorBracketHighlight.foreground1': '#79c0ff', 'editorBracketHighlight.foreground2': '#d2a8ff', 'editorBracketHighlight.foreground3': '#ff9bce' } });
      monacoApi = m; done(m);
    }, () => done(null));
  });
  const monacoTheme = () => root.dataset.theme === 'dark' ? 'zreview-dark' : 'zreview-light';
  let editorWatch = null;
  function mountEditors(pairs) {
    editorWatch?.disconnect();
    editorWatch = null;
    if (!monacoApi) return;
    const waiting = new Map(), live = new Set();
    for (const [f, root] of pairs) (f.entities || []).forEach((e, i) => {
      const exs = e.examples?.length ? e.examples : e.example !== undefined ? [{ title: 'Example', value: e.example }] : [];
      exs.forEach((x, j) => {
        const host = root.querySelector(`.examples[data-entity="${i}"] .ex[data-ex="${j}"] .editor`);
        if (!host) return;
        const id = `${f.id}\n${i}\n${j}`, kept = editors.get(id);
        live.add(id);
        if (kept) host.replaceWith(kept.host); else waiting.set(host, { id, x });
      });
    });
    for (const [id, kept] of editors) if (!live.has(id)) { kept.ed.dispose(); editors.delete(id); }
    const mount = (host) => {
      const { id, x } = waiting.get(host);
      waiting.delete(host);
      host.replaceChildren();
      const ed = monacoApi.editor.create(host, {
        value: exampleText(x), language: exampleLang(x), theme: monacoTheme(), readOnly: true, domReadOnly: true,
        minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: 'on', lineNumbersMinChars: 3, folding: true, glyphMargin: false,
        fontSize: 12, lineHeight: 19, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', renderLineHighlight: 'none', wordWrap: 'on',
        scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 8 }, overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
        bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, padding: { top: 10, bottom: 10 }, automaticLayout: true,
      });
      const fit = () => { host.style.height = `${Math.min(ed.getContentHeight(), 560)}px`; ed.layout(); };
      ed.onDidContentSizeChange(fit); fit();
      editors.set(id, { ed, host });
    };
    const hosts = [...waiting.keys()], folded = hosts.filter(host => !host.offsetParent);
    hosts.filter(host => host.offsetParent).forEach(mount);
    if (!folded.length) return;
    if (!window.IntersectionObserver) return folded.forEach(mount);
    editorWatch = new IntersectionObserver((hits) => hits.forEach(hit => {
      if (!hit.isIntersecting || !waiting.has(hit.target)) return;
      editorWatch.unobserve(hit.target);
      mount(hit.target);
    }));
    folded.forEach(host => editorWatch.observe(host));
  }

  const OPEN_UP_TO = 150;
  const shownSize = (file) => {
    const sh = shareOf(file);
    return sh ? (sh.hasAlone ? sh.exAdd + sh.exDel : sh.add + sh.del) : (file.add || 0) + (file.del || 0);
  };
  const isOpen = (f, file) => expanded[f.id]?.get(file.path) ?? (!!file.hunks?.length && !isViewed(f, file) && shownSize(file) <= OPEN_UP_TO);
  const pathHtml = (path) => {
    const cut = path.lastIndexOf('/') + 1;
    return `<span class="dir">${esc(path.slice(0, cut)).replaceAll('/', '/<wbr>')}</span><b>${esc(path.slice(cut))}</b>`;
  };
  function fileBlock(f, file, unit, cur) {
    const open = isOpen(f, file), seen = isViewed(f, file), ch = sinceOf(f).files[file.path];
    const upd = !!ch, chip = ch?.added != null ? `${ch.added} new line${ch.added === 1 ? '' : 's'}${ch.gone ? `, ${ch.gone} gone` : ''}` : 'updated since your last look';
    const sh = shareOf(file);
    const tally = (a, d) => [a ? `+${a}` : '', d ? `−${d}` : ''].filter(Boolean).join(' ');
    const counts = (a, d) => [a ? `<span class="a">+${a}</span>` : '', d ? `<span class="d">−${d}</span>` : ''].filter(Boolean).join(' ');
    const sharedAdd = sh ? sh.add - sh.exAdd : 0, sharedDel = sh ? sh.del - sh.exDel : 0;
    const stat = !file.hunks ? '' : sh
      ? `<span class="stat">${sh.hasAlone ? counts(sh.exAdd, sh.exDel) : ''}${sharedAdd + sharedDel ? `<span class="shared" title="${esc(`Lines this feature shares with ${ownerNames(sh.others)}`)}">${tally(sharedAdd, sharedDel)} shared</span>` : ''}${file.add + file.del ? `<span class="of">of ${tally(file.add, file.del)}</span>` : ''}</span>`
      : `<span class="stat">${counts(file.add, file.del)}</span>`;
    const also = sh?.others.length ? `<span class="also" title="${esc(`Also changed by ${ownerNames(sh.others)}`)}">also in ${sh.others.map(i =>
      `<a href="#${esc(data.features[i].id)}" target="_self" onclick="event.stopPropagation()">${i + 1}</a>`).join(' ')}</span>` : '';
    const firstLine = sh && file.hunks.flatMap(h => h.lines).find(l => sh.main(l));
    const url = firstLine ? `${file.url}${firstLine.t === '+' ? `R${firstLine.new}` : `L${firstLine.old}`}` : file.url;
    const says = seen ? `${file.path} is viewed. Take it back` : `Mark ${file.path} as viewed`;
    const said = entry(f.id).comments.filter(c => c.kind === 'file' && c.file === file.path);
    return `<div class="file ${seen ? 'seen' : ''}${unit && unit === cur ? ' cur' : ''}" data-path="${esc(file.path)}"${unit ? ` data-unit="${unit}"` : ''}>
      <div class="fh"><button type="button" class="d4-sign fv" aria-pressed="${seen}" aria-label="${esc(says)}" title="${esc(says)}" ${submitted ? 'disabled' : ''}>${seen ? '✓' : ''}</button>
        <div class="fline"><span class="tri">${open ? '▾' : '▸'}</span><span class="path">${pathHtml(file.path)}</span>${file.status ? `<span class="st">${esc(file.status)}</span>` : ''}${stat}${upd ? `<span class="upd">${esc(chip)}</span>` : ''}${also}${mdToggle(file)}${file.url ? `<a href="${esc(url)}" onclick="event.stopPropagation()">on GitHub</a>` : ''}</div></div>
      ${said.map(c => `<div class="lc"><div class="who">file comment${delBtn(c)}</div>${esc(c.body)}</div>`).join('')}
      ${open ? `<div class="fbody">${fileBody(f, file)}</div>` : ''}
    </div>`;
  }

  // Syntax highlighting: each side of a hunk is highlighted as one block so
  // multi-line tokens survive, then split back into lines.
  const LANG = { ts: 'typescript', tsx: 'typescript', mts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin', kts: 'kotlin', h: 'c', cc: 'cpp', hpp: 'cpp', cs: 'csharp', sh: 'bash', zsh: 'bash',
    yml: 'yaml', toml: 'ini', md: 'markdown', html: 'xml', vue: 'xml', svelte: 'xml', gql: 'graphql', dockerfile: 'dockerfile', makefile: 'makefile' };
  function langOf(path) {
    const name = path.split('/').pop().toLowerCase(), ext = name.includes('.') ? name.split('.').pop() : name;
    const l = LANG[ext] ?? ext;
    return window.hljs?.getLanguage(l) ? l : null;
  }
  const hlKnown = new Map();
  function hlLines(text, lang) {
    const known = `${lang}\n${text}`;
    if (!hlKnown.has(known)) hlKnown.set(known, hlSplit(text, lang));
    return hlKnown.get(known);
  }
  function hlSplit(text, lang) {
    let html;
    try { html = lang ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : esc(text); } catch { html = esc(text); }
    const out = [], open = []; let cur = '', last = 0, m;
    const re = /(<span[^>]*>)|(<\/span>)|\n/g;
    while ((m = re.exec(html))) {
      cur += html.slice(last, m.index); last = re.lastIndex;
      if (m[1]) { open.push(m[1]); cur += m[1]; }
      else if (m[2]) { open.pop(); cur += m[2]; }
      else { out.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
    }
    out.push(cur + html.slice(last) + '</span>'.repeat(open.length));
    return out;
  }

  function hunks(f, file) {
    if (!file.hunks) return `<p class="none" style="padding:8px 12px">Diff not loaded. Run with the PR's diff (gh on PATH, or --diff).</p>`;
    if (!file.hunks.length) return `<p class="none" style="padding:8px 12px">${file.status === 'binary' ? 'Binary file.' : 'No text changes.'}</p>`;
    const cs = entry(f.id).comments.filter(c => c.kind === 'line' && c.file === file.path);
    const lang = langOf(file.path);
    const fresh = freshFlags(f, file);                        // lines the reviewer has not seen
    // A comment on a line no row below shows is listed above the rows instead of vanishing: one made on an
    // unchanged block in the rendered view, or one whose line the author's rework moved out of the diff.
    const rows = new Set(file.hunks.flatMap(h => h.lines.map(l => l.t === '-' ? `old ${l.old}` : `new ${l.new}`)));
    const outside = cs.filter(c => !rows.has(`${c.side} ${c.line}`)).map(c =>
      `<div class="lc outside"><div class="who">${c.side === 'old' ? 'old ' : ''}line ${c.line}, outside the diff${delBtn(c)}</div>${esc(c.body)}</div>`).join('');
    const sh = shareOf(file);
    const lines = file.hunks.flatMap((h, hi) => {
      const oh = hlLines(h.lines.filter(l => l.t !== '+').map(l => l.text).join('\n'), lang);
      const nh = hlLines(h.lines.filter(l => l.t !== '-').map(l => l.text).join('\n'), lang);
      let oi = 0, ni = 0;
      return h.lines.map(l => ({ l, hi, side: l.t === '-' ? 'old' : 'new', line: l.t === '-' ? l.old : l.new, code: l.t === '-' ? oh[oi++] : l.t === '+' ? nh[ni++] : (oi++, nh[ni++]) }));
    });
    const pinned = lines.map(x => !sh || sh.main(x.l) || cs.some(c => c.side === x.side && c.line === x.line));
    const near = lines.map(() => !sh);
    for (const order of sh ? [lines.map((_, i) => i), lines.map((_, i) => lines.length - 1 - i)] : []) {
      let at = null;
      for (const i of order) {
        if (pinned[i]) at = i;
        if (at !== null && lines[at].hi === lines[i].hi && Math.abs(i - at) <= 3) near[i] = true;
      }
    }
    const whoElse = (l) => sh.owners(l).filter(o => o !== sh.self);
    const runKey = (i) => {
      const kind = lineKind(sh, lines[i].l);
      return kind === 'foreign' || kind === 'shared' ? `${kind} ${whoElse(lines[i].l).join()}` : null;
    };
    const row = (i, tagged) => {
      const { l, side, line, code } = lines[i];
      const mine = cs.filter(c => c.side === side && c.line === line);
      const kind = lineKind(sh, l);
      const isNew = fresh?.[i];
      return `<div class="dl ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''} ${kind} ${mine.length ? 'has' : ''} ${isNew ? 'fresh' : ''}" data-side="${side}" data-line="${line}" ${isNew ? 'title="New since your last look"' : ''}>
          <span class="g">${l.old ?? ''}</span><span class="g">${l.new ?? ''}</span><span class="code"><span class="sign">${l.t}</span>${code}</span>${tagged ? ownerTag(whoElse(l), kind === 'shared') : ''}</div>` +
        mine.map(c => `<div class="lc"><div class="who">line comment${delBtn(c)}</div>${esc(c.body)}</div>`).join('');
    };
    const foldKey = (i) => `${f.id}\n${file.path}\n${i}`;
    const fold = (i, j) => {
      const shared = new Set(), theirs = new Set(); let ns = 0, nf = 0;
      for (let k = i; k < j; k++) {
        const l = lines[k].l, kind = lineKind(sh, l);
        if (kind === 'shared') { ns++; whoElse(l).forEach(o => shared.add(o)); }
        else if (kind === 'foreign') { nf++; whoElse(l).forEach(o => theirs.add(o)); }
      }
      const s = (n) => n === 1 ? '' : 's';
      const parts = [
        ...(ns ? [`${ns} changed line${s(ns)} shared with ${ownerRefs(shared)}`] : []),
        ...(nf ? [`${nf} changed line${s(nf)} of ${ownerRefs(theirs)}`] : []),
      ];
      return `<button type="button" class="fold" data-fold="${esc(foldKey(i))}" title="${esc(ownerNames(new Set([...shared, ...theirs])))}">⋯ ${esc(parts.length ? parts.join(' · ') : `${j - i} unchanged lines`)}</button>`;
    };
    let out = '', open = null;
    const headed = new Set();
    const close = () => { if (open !== null) { out += '</div>'; open = null; } };
    const enter = (hi) => {
      if (open === hi) return;
      close();
      out += `<div class="hunk">${headed.has(hi) ? '' : `<div class="hh">${esc(file.hunks[hi].header)}</div>`}`;
      headed.add(hi); open = hi;
    };
    for (let i = 0; i < lines.length;) {
      let j = i + 1;
      if (!near[i]) while (j < lines.length && !near[j]) j++;
      if (!near[i] && j - i >= 4 && !unfolded.has(foldKey(i))) { close(); out += fold(i, j); i = j; continue; }
      for (; i < j; i++) {
        const key = runKey(i), same = key && open === lines[i].hi && i > 0 && lines[i - 1].hi === lines[i].hi && runKey(i - 1) === key;
        enter(lines[i].hi);
        out += row(i, key && !same);
      }
    }
    close();
    return outside + out;
  }
  const unfolded = new Set();
  function freshFlags(f, file) {
    const fresh = sinceOf(f).files[file.path]?.fresh;
    if (!fresh || !file.hunks) return null;
    const sh = shareOf(file);
    let k = 0;
    return file.hunks.flatMap(h => h.lines.map(l => !sh || sh.owns(l) ? !!fresh[k++] : false));
  }

  const MARKDOWN = /\.(md|markdown|mdx)$/i;
  const PURIFY = { FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option'], FORBID_ATTR: ['style', 'form', 'formaction'] };
  let mdView = localStorage.getItem('zreview:mdview') || 'rendered';
  const richCache = new WeakMap(), richOpen = new Set();

  function mdUnits(source, ref, dir) {
    const text = source.replace(/\r\n?/g, '\n').replace(/^( *)(\t+)/gm, (_, s, t) => s + '    '.repeat(t.length));
    const units = [];
    let cursor = 0, pos = 0, line = 1;
    const lineAt = (at) => { for (; pos < at; pos++) if (text.charCodeAt(pos) === 10) line++; return line; };
    const span = (raw) => {
      const at = Math.max(text.indexOf(raw, cursor), cursor);
      cursor = at + raw.length;
      return { from: lineAt(at), to: lineAt(at + Math.max(raw.trimEnd().length - 1, 0)) };
    };
    const unit = (type, raw, key, extra) => units.push({ type, raw, key, ref, dir, ...extra, ...span(raw) });
    const front = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
    if (front) unit('front', front[0], 'front\n' + front[0].trim());
    for (const t of marked.lexer(text.slice(cursor))) {
      if (t.type === 'space') { span(t.raw); continue; }
      if (t.type !== 'list') { unit(t.type, t.raw, `${t.type}${t.depth ?? ''}\n${t.raw.trim()}`, { token: t }); continue; }
      const at = Math.max(text.indexOf(t.raw, cursor), cursor);
      cursor = at;
      for (const item of t.items) unit('item', item.raw, `item${t.ordered ? 1 : ''}\n${item.raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()}`, { list: t, item });
      cursor = Math.max(cursor, at + t.raw.length);
    }
    // marked keeps some source out of every token: a link reference definition (`[docs]: https://…`) sets
    // the target of every `[docs]` without a block of its own. A change there would not show in the rendered
    // view at all, so each run of non-blank lines that no block covers becomes a block of its own.
    const lines = text.split('\n'), covered = new Uint8Array(lines.length + 2), loose = [];
    for (const u of units) for (let n = u.from; n <= u.to; n++) covered[n] = 1;
    for (let n = 1; n <= lines.length; n++) {
      if (covered[n] || !lines[n - 1].trim()) continue;
      let m = n;
      while (m < lines.length && !covered[m + 1] && lines[m].trim()) m++;
      const raw = lines.slice(n - 1, m).join('\n');
      loose.push({ type: 'raw', raw, key: `raw\n${raw.trim()}`, ref, dir, from: n, to: m });
      n = m;
    }
    return loose.length ? [...units, ...loose].sort((x, y) => x.from - y.from) : units;
  }

  function resolveLinks(root, ref, dir) {
    const fix = (el, attr, kind) => {
      const v = el.getAttribute(attr);
      if (!v || /^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(v)) return;
      el.setAttribute(attr, new URL(v.startsWith('/') ? `.${v}` : dir + v, `https://github.com/${data.pr.repo}/${kind}/${ref}/`).href);
    };
    root.querySelectorAll('a[href]').forEach(a => fix(a, 'href', 'blob'));
    root.querySelectorAll('img[src]').forEach(img => fix(img, 'src', 'raw'));
  }
  function renderUnit(u) {
    if (u.html !== undefined) return u;
    const html = u.type === 'front' || u.type === 'raw' ? `<pre class="rd-${u.type}"><code>${esc(u.raw.trim())}</code></pre>`
      : marked.parser([u.type === 'item' ? { ...u.list, items: [u.item] } : u.token]);
    const box = document.createElement('div');
    box.innerHTML = DOMPurify.sanitize(html, PURIFY);
    const body = u.type === 'item' ? box.querySelector('li') || box : box;
    if (!body.textContent.trim() && !body.querySelector('img, hr, input')) body.innerHTML = `<pre class="rd-raw"><code>${esc(u.raw.trim())}</code></pre>`;
    body.querySelectorAll('input').forEach(i => i.type === 'checkbox' ? (i.disabled = true) : i.remove());
    u.text = body.textContent;
    resolveLinks(body, u.ref, u.dir);
    body.querySelectorAll('pre code[class*="language-"]').forEach(el => {
      const lang = /language-(\S+)/.exec(el.className)[1];
      if (window.hljs?.getLanguage(lang)) hljs.highlightElement(el);
    });
    u.html = body.innerHTML;
    return u;
  }
  const unitText = (u) => renderUnit(u).text;
  const unitHtml = (u) => renderUnit(u).html;

  function blockOps(a, b) {
    let s = 0, e = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    const midA = a.slice(s, a.length - e), midB = b.slice(s, b.length - e);
    if (midA.length * midB.length > 4e6) return null;
    const ops = [];
    for (let k = 0; k < s; k++) ops.push(['same', k, k]);
    for (const [kind, i, j] of lcsOps(midA, midB)) ops.push([kind, i < 0 ? -1 : i + s, j < 0 ? -1 : j + s]);
    for (let k = 0; k < e; k++) ops.push(['same', a.length - e + k, b.length - e + k]);
    return ops;
  }
  const byLine = (u) => u.type === 'front' || u.type === 'raw' || u.type === 'code';
  const linesOf = (u) => (u.type === 'code' ? u.token.text : u.raw.trim()).split('\n');
  // How much two blocks share: the pieces both contain, weighted by length, over the larger block. Pairing
  // asks this of every removed and added block in a changed stretch, so it counts instead of aligning:
  // linear in the blocks' size, where a word-level LCS per pair could freeze the tab on a long rewrite.
  function overlap(a, b) {
    const left = new Map(); let sizeA = 0, sizeB = 0, same = 0;
    for (const t of a) { left.set(t, (left.get(t) || 0) + 1); sizeA += t.length; }
    for (const t of b) { sizeB += t.length; const k = left.get(t); if (k) { left.set(t, k - 1); same += t.length; } }
    return same / Math.max(sizeA, sizeB, 1);
  }
  function likeness(o, n) {
    if (o.type !== n.type || o.token?.depth !== n.token?.depth || (o.type === 'item' && o.list.ordered !== n.list.ordered)) return 0;
    if (o.type === 'table' && (o.token.header.length !== n.token.header.length || o.token.rows.length !== n.token.rows.length)) return 0;
    if (byLine(o)) {
      const a = linesOf(o), b = linesOf(n);
      return a.join('\n') === b.join('\n') ? 0 : overlap(a, b);
    }
    // Adjacent word pairs, not words: two unrelated paragraphs share most of their small words, but few
    // of their word pairs, so a rewrite still reads as removed then added.
    const a = unitText(o), b = unitText(n);
    const pairs = (t) => { const w = t.split(/\s+/).filter(Boolean); return w.length < 2 ? w : w.slice(1).map((x, i) => `${w[i]} ${x}`); };
    return a === b ? 0 : overlap(pairs(a), pairs(b));
  }
  function pairUp(ops, a, b) {
    const out = [];
    for (let k = 0; k < ops.length;) {
      if (ops[k][0] === 'same') { out.push({ kind: 'same', old: a[ops[k][1]], new: b[ops[k][2]] }); k++; continue; }
      const gone = [], come = [];
      for (; k < ops.length && ops[k][0] !== 'same'; k++) ops[k][0] === 'del' ? gone.push(a[ops[k][1]]) : come.push(b[ops[k][2]]);
      let next = 0;
      for (const o of gone) {
        let best = -1, score = 0.5;
        if (gone.length * come.length <= 400) for (let y = next; y < come.length; y++) { const s = likeness(o, come[y]); if (s > score) { best = y; score = s; } }
        if (best < 0) { out.push({ kind: 'del', old: o }); continue; }
        for (; next < best; next++) out.push({ kind: 'add', new: come[next] });
        out.push({ kind: 'mod', old: o, new: come[next++] });
      }
      for (; next < come.length; next++) out.push({ kind: 'add', new: come[next] });
    }
    return out;
  }
  function richModel(file) {
    if (richCache.has(file)) return richCache.get(file);
    let model = null;
    try {
      const dir = file.path.slice(0, file.path.lastIndexOf('/') + 1);
      const a = mdUnits(file.text.before, data.pr.base, dir), b = mdUnits(file.text.after, data.pr.head, dir);
      const ops = blockOps(a.map(u => u.key), b.map(u => u.key));
      if (ops) model = pairUp(ops, a, b);
    } catch (e) { console.error(`zreview: could not render ${file.path}`, e); }
    richCache.set(file, model);
    return model;
  }

  function markWords(root, before) {
    const parts = wordDiff(before, root.textContent);
    if (!parts) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    let k = 0, off = 0;
    const gone = (text) => {
      const d = document.createElement('del'); d.textContent = text;
      if (k >= nodes.length) return nodes.length && nodes[nodes.length - 1].after(d);
      if (off) { nodes[k] = nodes[k].splitText(off); off = 0; }
      nodes[k].before(d);
    };
    for (const p of parts) {
      if (p.kind === 'del') { if (p.text.trim()) gone(p.text); continue; }
      for (let left = p.text.length; left > 0 && k < nodes.length;) {
        const node = nodes[k], take = Math.min(node.data.length - off, left);
        left -= take;
        if (p.kind === 'ins' && node.data.slice(off, off + take).trim()) {
          const seg = off ? node.splitText(off) : node, rest = take < seg.data.length ? seg.splitText(take) : null;
          const ins = document.createElement('ins'); seg.before(ins); ins.append(seg);
          if (rest) nodes[k] = rest; else k++;
          off = 0;
        } else if ((off += take) >= node.data.length) { k++; off = 0; }
      }
    }
  }
  function lineDiffHtml(o, n) {
    const lang = n.type === 'front' ? 'yaml' : n.type === 'raw' ? 'markdown' : (n.token.lang || '').split(/\s/)[0];
    const known = window.hljs?.getLanguage(lang) ? lang : null;
    const a = linesOf(o), b = linesOf(n), ha = hlLines(a.join('\n'), known), hb = hlLines(b.join('\n'), known);
    const ops = lcsOps(a, b), line = ([kind, i, j]) => `<span class="ln ${kind}">${kind === 'del' ? ha[i] : hb[j]}</span>`;
    const near = ops.map((_, k) => ops.slice(Math.max(0, k - 2), k + 3).some(([kind]) => kind !== 'same'));
    let out = '';
    for (let k = 0; k < ops.length;) {
      let m = k + 1;
      if (!near[k]) while (m < ops.length && !near[m]) m++;
      const run = ops.slice(k, m).map(line).join('');
      out += !near[k] && m - k >= 4 ? `<button type="button" class="rd-gap">⋯ ${m - k} unchanged lines</button><span hidden>${run}</span>` : run;
      k = m;
    }
    return `<pre class="rd-lines"><code>${out}</code></pre>`;
  }
  function entryHtml(e) {
    if (e.kind !== 'mod') return unitHtml(e.kind === 'del' ? e.old : e.new);
    if (e.html === undefined && byLine(e.new)) e.html = lineDiffHtml(e.old, e.new);
    if (e.html === undefined) {
      const box = document.createElement('div');
      box.innerHTML = unitHtml(e.new);
      markWords(box, unitText(e.old));
      e.html = box.innerHTML;
    }
    return e.html;
  }

  const rdFailed = new WeakSet();                  // files whose rendered view threw; they stay on their source diff
  const canRender = (file) => MARKDOWN.test(file.path) && !!file.text && !!window.DOMPurify && !rdFailed.has(file) && !!richModel(file);
  function fileBody(f, file) {
    if (mdView !== 'rendered' || !canRender(file)) return hunks(f, file);
    // Blocks render lazily, here, outside richModel's guard. A block marked or hljs chokes on costs this
    // file its rendered view; it must not blank the whole feature.
    try { return richDiff(f, file); }
    catch (e) {
      console.error(`zreview: could not render ${file.path}`, e);
      rdFailed.add(file);
      return `<p class="none rd-note">The rendered view failed for this file, so it shows the source diff.</p>${hunks(f, file)}`;
    }
  }
  function mdToggle(file) {
    if (!MARKDOWN.test(file.path) || !file.hunks?.length) return '';
    const can = canRender(file), on = mdView === 'rendered' && can;
    const why = can ? '' : !window.DOMPurify ? 'The sanitizer did not load, so Markdown shows as source'
      : !file.text ? 'No rendered view: it needs the whole file, which zreview fetches with gh at the head commit'
      : rdFailed.has(file) ? 'The rendered view failed for this file, so it shows as source'
      : 'No rendered view: the two versions are too large to compare block by block, or marked could not read them';
    return `<span class="mdview"${why ? ` title="${esc(why)}"` : ''}><button type="button" data-mdview="rendered" class="${on ? 'on' : ''}" ${can ? '' : 'disabled'}>Rendered</button><button type="button" data-mdview="source" class="${on ? '' : 'on'}">Source</button></span>`;
  }
  function setMdView(v) { mdView = v; localStorage.setItem('zreview:mdview', v); render(); renderFocus(); }
  function bindRendered(root, f, redraw) {
    root.querySelectorAll('[data-mdview]').forEach(b => b.onclick = (e) => { e.stopPropagation(); if (!b.disabled) setMdView(b.dataset.mdview); });
    root.querySelectorAll('.rd-u > .rc').forEach(b => b.onclick = () => { if (!submitted) openLineComposer(f, b.parentElement, redraw); });
    root.querySelectorAll('.rd-more').forEach(b => b.onclick = () => { richOpen.add(b.dataset.more); redraw(); });
    root.querySelectorAll('.fold').forEach(b => b.onclick = (e) => { e.stopPropagation(); unfolded.add(b.dataset.fold); redraw(); });
    root.querySelectorAll('.rd-gap').forEach(b => b.onclick = (e) => { e.stopPropagation(); b.nextElementSibling.hidden = false; b.remove(); });
  }

  function richDiff(f, file) {
    const rows = richModel(file);
    const unitOn = (e, side) => side === 'old' ? e.old : e.kind === 'del' ? null : e.new;
    const own = new Map();
    for (const c of entry(f.id).comments.filter(c => c.kind === 'line' && c.file === file.path)) {
      let at = -1;
      rows.forEach((e, i) => { const u = unitOn(e, c.side); if (u && u.from <= c.line) at = i; });
      if (at < 0) at = Math.max(rows.findIndex(e => unitOn(e, c.side)), 0);
      own.set(at, [...(own.get(at) || []), c]);
    }
    const fresh = freshFlags(f, file), unseen = { old: new Set(), new: new Set() };
    if (fresh) { let fi = 0; for (const h of file.hunks) for (const l of h.lines) if (fresh[fi++]) l.t === '-' ? unseen.old.add(l.old) : unseen.new.add(l.new); }
    const isFresh = (e) => ['old', 'new'].some(side => {
      const u = unitOn(e, side);
      for (let n = u?.from; u && n <= u.to; n++) if (unseen[side].has(n)) return true;
      return false;
    });
    const sh = shareOf(file);
    const ownIn = (e) => (e.new && sh.touches('new', e.new)) || (e.old && sh.touches('old', e.old));
    const aloneIn = (e) => (e.new && sh.touchesAlone('new', e.new)) || (e.old && sh.touchesAlone('old', e.old));
    const rowKind = (e) => !sh || e.kind === 'same' ? '' : !ownIn(e) ? 'foreign' : aloneIn(e) ? 'mine' : 'shared';
    const theirsOf = (e) => new Set([...(e.new ? sh.span('new', e.new) : []), ...(e.old ? sh.span('old', e.old) : [])]);
    const isMain = (e) => e.kind !== 'same' && (!sh || (sh.hasAlone ? aloneIn(e) : ownIn(e)));
    const changed = rows.map((e, i) => isMain(e) || own.has(i));
    const near = rows.map((_, i) => changed.slice(Math.max(0, i - 2), i + 3).some(Boolean));
    const foldKey = (i) => `${f.id}\n${file.path}#${i}`;
    const folded = new Map();
    for (let i = 0; i < rows.length;) {
      if (near[i]) { i++; continue; }
      let j = i; while (j < rows.length && !near[j]) j++;
      if (j - i >= 3 && !richOpen.has(foldKey(i))) folded.set(i, j);
      i = j;
    }
    const row = (i, tag) => {
      const e = rows[i], side = e.kind === 'del' ? 'old' : 'new', u = unitOn(e, side), nw = isFresh(e);
      const kind = rowKind(e);
      const notes = (own.get(i) || []).map(c => `<div class="lc"><div class="who">line comment${delBtn(c)}</div>${esc(c.body)}</div>`).join('');
      const body = kind === 'foreign' ? `${ownerTag(theirsOf(e))}<div class="dim">${entryHtml(e)}</div>`
        : kind === 'shared' ? `${ownerTag(theirsOf(e), true)}${entryHtml(e)}` : entryHtml(e);
      return `<${tag} class="rd-u ${e.kind}${kind ? ` ${kind}` : ''} t-${u.type}${nw ? ' fresh' : ''}" data-side="${side}" data-line="${u.from}"${nw ? ' title="New since your last look"' : ''}>`
        + `${submitted ? '' : '<button type="button" class="rc" title="Comment on this">+</button>'}${body}${tag === 'li' ? notes : ''}</${tag}>${tag === 'li' ? '' : notes}`;
    };
    const foldLabel = (i, n) => {
      const shared = new Set(), theirs = new Set(); let ns = 0, nf = 0;
      for (let k = i; k < i + n; k++) {
        const kind = rowKind(rows[k]);
        if (kind === 'shared') { ns++; theirsOf(rows[k]).forEach(o => shared.add(o)); }
        else if (kind === 'foreign') { nf++; theirsOf(rows[k]).forEach(o => theirs.add(o)); }
      }
      const s = (x) => x === 1 ? '' : 's', rest = n - ns - nf;
      return {
        title: ownerNames(new Set([...shared, ...theirs])),
        text: [
          ...(ns ? [`${ns} changed block${s(ns)} shared with ${ownerRefs(shared)}`] : []),
          ...(nf ? [`${nf} changed block${s(nf)} of ${ownerRefs(theirs)}`] : []),
          ...(rest ? [`${rest} unchanged block${s(rest)}`] : []),
        ].join(' · '),
      };
    };
    const out = [];
    for (let i = 0; i < rows.length;) {
      if (folded.has(i)) {
        const n = folded.get(i) - i;
        const label = foldLabel(i, n);
        out.push(`<button type="button" class="rd-more" data-more="${esc(foldKey(i))}"${label.title ? ` title="${esc(label.title)}"` : ''}>⋯ ${esc(label.text)}</button>`);
        i += n; continue;
      }
      const u = rows[i].new ?? rows[i].old;
      if (u.type !== 'item') { out.push(row(i++, 'div')); continue; }
      const items = [];
      for (; i < rows.length && !folded.has(i) && (rows[i].new ?? rows[i].old).type === 'item' && (rows[i].new ?? rows[i].old).list.ordered === u.list.ordered; i++) items.push(row(i, 'li'));
      const start = Number(/^\s*(\d+)/.exec(u.raw)?.[1] ?? 1);
      out.push(u.list.ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    }
    return `<div class="rd">${out.join('')}</div>`;
  }

  function findPlain(hay, phrase) {
    const map = [], chars = [];
    for (let i = 0; i < hay.length; i++) {
      const c = hay[i];
      if (/[`*_]/.test(c)) continue;
      if (/\s/.test(c)) { if (!chars.length || chars[chars.length - 1] === ' ') continue; chars.push(' '); map.push(i); continue; }
      chars.push(c); map.push(i);
    }
    const norm = chars.join(''), needle = phrase.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim(), out = [];
    for (let at = needle ? norm.indexOf(needle) : -1; at >= 0; at = norm.indexOf(needle, at + needle.length)) out.push([map[at], map[at + needle.length - 1] + 1]);
    return out;
  }
  function textSegments(root, keep) {
    const segs = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest('.rc, .whose, .lc, .sign') || !keep(n)) continue;
      segs.push({ n, s: pos, e: pos += n.data.length });
    }
    return { segs, text: segs.map(x => x.n.data).join('') };
  }
  function paint(seg, ranges, changed) {
    const inside = (a, b) => ranges.some(([x, y]) => a >= x && b <= y);
    const pieces = [{ node: seg.n, s: seg.s }];
    for (const c of [...new Set(ranges.flat())].filter(c => c > seg.s && c < seg.e).sort((a, b) => b - a)) pieces.splice(1, 0, { node: seg.n.splitText(c - seg.s), s: c });
    pieces.forEach((p, k) => {
      const cls = inside(p.s, k + 1 < pieces.length ? pieces[k + 1].s : seg.e) ? 'ph' : changed ? 'ph-other' : null;
      if (!cls || !p.node.data) return;
      const span = document.createElement('span');
      span.className = cls;
      p.node.before(span); span.append(p.node);
    });
  }
  function markPhrases(root, f) {
    for (const el of root.querySelectorAll('.file[data-path]')) {
      const phrases = (f.files || []).find(x => x.path === el.dataset.path)?.phrases;
      if (!phrases?.length) continue;
      for (const row of el.querySelectorAll('.dl.add:not(.foreign), .dl.del:not(.foreign)')) {
        const { segs, text } = textSegments(row.querySelector('.code'), () => true);
        const ranges = phrases.flatMap(p => findPlain(text, p));
        segs.forEach(seg => paint(seg, ranges, false));
      }
      for (const row of el.querySelectorAll('.rd-u:not(.foreign):not(.same)')) {
        const inDel = (n) => !!n.parentElement.closest('del'), inIns = (n) => !!n.parentElement.closest('ins');
        const now = textSegments(row, n => !inDel(n)), was = textSegments(row, n => !inIns(n));
        const nowRanges = phrases.flatMap(p => findPlain(now.text, p)), wasRanges = phrases.flatMap(p => findPlain(was.text, p));
        if (!nowRanges.length && !wasRanges.length) continue;
        now.segs.forEach(seg => paint(seg, nowRanges, inIns(seg.n)));
        was.segs.filter(seg => inDel(seg.n)).forEach(seg => paint(seg, wasRanges, true));
      }
    }
  }

  function commentList(f, what = 'feature') {
    const cs = entry(f.id).comments;
    if (!cs.length) return `<p class="none">No comments on this ${what}.</p>`;
    return cs.map(c => `<div class="cm">
      <div class="who"><span class="where">${c.kind === 'line' ? `${esc(c.file)}:${c.line} (${c.side})` : c.kind === 'file' ? esc(c.file) : esc(c.section)}</span>${delBtn(c)}</div>
      ${c.quote ? `<div class="quote">${esc(c.quote)}</div>` : ''}${esc(c.body)}</div>`).join('');
  }

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const servedBy = (id) => ({
    features: data.features.filter(f => (f.serves || []).includes(id)),
    rules: data.features.flatMap(f => (f.rules || []).filter(r => (r.serves || []).includes(id))),
  });
  const checkedBy = (id) => data.features.flatMap(f => (f.behaviours || []).filter(b => (b.checks || []).includes(id)));
  const codeOf = (b, path) => {
    const has = (f) => (f.files || []).some(x => x.path === path && x.hunks?.length);
    return data.features.find(f => (f.behaviours || []).includes(b) && has(f)) || data.features.find(has);
  };

  const WHOLE = {
    '@high': 'Nothing is missing: these goals and limits are the whole purpose of the change.',
    '@mid': 'Nothing is missing: these scenarios and rules are everything the product does differently.',
    '@low': 'Nothing is missing: these behaviours are the cases a tester would try.',
  };
  const KIND = { goal: 'Goal', 'non-goal': 'Out of scope', rule: 'Rule', behaviour: 'Behaviour' };
  const PROOF = { test: 'A test in this PR', stand: 'Seen on a stand', reading: 'Read in the code, no test', none: 'Not covered' };
  const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl ';
  const clauses = new Map(), sections = {}, order = {};
  if (LAYERED) {
    const put = (level, sec, kind, src, id = src.id) => { clauses.set(id, { id, level, kind, src }); sec.ids.push(id); };
    const high = [], mid = [], low = [];
    if (!ABSENT) {
      const goals = { title: 'Goals', ids: [] }, out = { title: 'Out of scope', ids: [], none: 'None stated.' };
      for (const g of data.purpose.goals || []) put('@high', goals, 'goal', g);
      for (const g of data.purpose.nonGoals || []) put('@high', out, 'non-goal', g);
      high.push(goals, out);
    }
    data.features.forEach((f, i) => {
      const m = { n: i + 1, title: f.title, feature: f, ids: [] };
      put('@mid', m, 'scenario', f);
      for (const r of f.rules || []) put('@mid', m, 'rule', r);
      mid.push(m);
      const l = { n: i + 1, title: f.title, feature: f, ids: [], none: 'No behaviour is written for this.' };
      for (const b of f.behaviours || []) put('@low', l, 'behaviour', b);
      low.push(l);
    });
    const libs = { title: 'New libraries and frameworks', ids: [], none: `None. ${data.alignment?.manifests?.length ? data.librariesNote || '' : 'No package manifest changed in this PR.'}` };
    for (const lib of data.libraries || []) put('@low', libs, 'library', lib, `lib:${lib.name}`);
    low.push(libs);
    for (const [level, list] of [['@high', high], ['@mid', mid], ['@low', low]]) {
      const whole = { title: 'The level as a whole', ids: [] };
      put(level, whole, 'whole', {}, `${level}*`);
      list.push(whole);
      sections[level] = list;
      order[level] = list.flatMap(s => s.ids);
    }
  }
  const unserved = new Set(data.alignment?.unserved || []), unchecked = new Set(data.alignment?.unchecked || []);
  const around = (level) => level === '@high' ? [data.purpose.summary, data.purpose.domain, data.purpose.sources, ...(data.pr.exposure ? [data.pr.exposure] : [])]
    : level === '@mid' ? data.features.map(f => [f.title, (f.entities || []).map(e => [e.label, e.change, e.summary]), f.screenshots?.caption])
    : [data.features.map(f => [f.title, f.diagrams]), data.librariesNote];
  const clauseHash = (c) => hashStr(JSON.stringify(
    c.kind === 'whole' ? [order[c.level], around(c.level)] : c.kind === 'scenario' ? [c.src.scenario, c.src.serves, c.src.derived] : c.src,
    (k, v) => k === 'before_src' || k === 'after_src' ? undefined : v));
  const stepWords = (b) => [['Given', b.given], ['When', b.when], ['Then', b.then]]
    .filter(([, list]) => list?.length).map(([kw, list]) => `${kw} ${list.join(', and ')}.`).join(' ');
  const clauseText = (c) => c.kind === 'whole' ? ''
    : c.kind === 'scenario' ? c.src.scenario || ''
    : c.kind === 'behaviour' ? `${c.src.title}. ${stepWords(c.src)}`.trim()
    : c.kind === 'library' ? `${c.src.name}${c.src.version ? ` ${c.src.version}` : ''}: ${c.src.why}`
    : c.src.text;
  const clauseName = (c) => c.kind === 'whole' ? 'The level as a whole' : c.kind === 'scenario' ? `Scenario of ${c.src.id}` : c.kind === 'library' ? `Library ${c.src.name}` : c.id;
  const rowOf = (id) => { const c = clauses.get(id); return c && state[c.level]?.rows?.[id]; };
  const dec = (id) => rowOf(id)?.d;
  const tallyOf = (level) => {
    const ids = order[level] || [], ok = ids.filter(x => dec(x) === 'ok').length, ch = ids.filter(x => dec(x) === 'change').length;
    return { n: ids.length, ok, ch, open: ids.length - ok - ch };
  };
  const levelMoved = (level) => Object.values(state[level]?.rows || {}).some(r => r.was);
  function settleLevel(level) {
    const s = entry(level), t = tallyOf(level);
    const decision = t.ch ? 'changes' : t.open ? undefined : 'approved';
    if (s.decision === decision) return false;
    if (decision) Object.assign(s, { decision, at: Date.now(), head: data.pr.head || 'plan' });
    else { delete s.decision; delete s.at; delete s.head; }
    return true;
  }
  function syncLevels() {
    let moved = false;
    for (const l of LEVELS) {
      const rows = state[l.id]?.rows || {};
      for (const [id, r] of Object.entries(rows)) {
        const c = clauses.get(id);
        if (!c || c.level !== l.id) { delete rows[id]; moved = true; continue; }
        const same = r.hash === clauseHash(c);
        if (r.d && !same) { r.was = r.d; delete r.d; moved = true; }
        else if (r.was && same) { r.d = r.was; delete r.was; moved = true; }
      }
      if (settleLevel(l.id)) moved = true;
    }
    if (moved) save();
  }

  const cursor = {};
  let composing = null, draft = '', pendingItem = null;
  const at = (level) => {
    const ids = order[level];
    if (!ids.includes(cursor[level])) cursor[level] = ids.find(x => !dec(x)) || ids[0];
    return cursor[level];
  };
  const dref = (id, text = id, quiet = false) => `<a class="dref" href="#${esc(items.get(id)?.level || '')}" target="_self" data-go="${esc(id)}"${quiet ? ' data-quiet' : ''}>${esc(text)}</a>`;
  const drefs = (ids) => ids.map(id => dref(id)).join(', ');
  const fref = (f) => dref(f.id, f.title);
  function originOf(c) {
    const s = c.src, from = s.from ? inl(String(s.from).replace(/\.$/, '')) : '';
    if (s.source === 'stated') return { call: false, html: `Stated: ${from}.` };
    if (s.source === 'decided') return { call: true, html: `The author’s call${from ? ` (${from})` : ''}. Yours to confirm.` };
    if (s.source === 'inferred') return { call: true, html: 'Inferred from the change. Nobody wrote it down.' };
    return null;
  }
  function cautions(c) {
    const s = c.src, out = [];
    if (c.kind === 'goal' && unserved.has(c.id)) out.push('Nothing in this PR serves it.');
    if (c.kind === 'rule' && unchecked.has(c.id)) out.push('No behaviour checks it. Until one does, it is a promise.');
    if (s.derived) out.push(`${c.kind === 'behaviour' ? 'Checks no rule.' : 'Serves no goal.'} ${inl(s.derived)}`);
    if (s.flag) out.push(inl(s.flag));
    return out;
  }
  function lapsed(c, r) {
    const said = r.seen && r.seen !== clauseText(c) ? ` It said: “${inl(r.seen)}”` : '';
    const asked = r.was === 'change' ? ` You asked: “${esc(r.note)}”` : '';
    if (c.kind === 'whole') return `<b>The level changed since you ${asked ? 'asked for a change' : 'signed this'}.</b>${asked}`;
    if (asked) return `<b>Reworked since you asked for a change.</b>${asked}${said}`;
    return `<b>${said ? 'Reworded' : c.src.screenshots ? 'Its margin note or its screenshot changed' : 'Its margin note changed'} since you signed it.</b>${said}`;
  }
  function noteHtml(c, open) {
    const s = c.src, r = rowOf(c.id), out = [];
    const call = (html) => out.push(`<p class="call">${html}</p>`), quiet = (html) => out.push(`<p>${html}</p>`);
    if (r?.was) call(lapsed(c, r));
    if (c.kind === 'whole') {
      if (open) quiet('Sign it when nothing is missing. Request a change to say what is.');
    } else if (c.kind === 'library') {
      if (s.where) quiet(`In ${inl(s.where)}.`);
    } else if (c.kind === 'behaviour') {
      const e = s.evidence, strong = e.by === 'test' || e.by === 'stand', warn = cautions(c);
      const label = `<b>${e.by === 'test' && e.existing ? 'A test that was already there' : PROOF[e.by]}.</b>`;
      if (!open) (strong && !warn.length ? quiet : call)(`${label}${warn.length ? ` ${plural(warn.length, 'warning')}.` : ''}`);
      else {
        const home = e.by === 'test' && codeOf(s, e.file), base = e.by === 'test' ? esc(e.file.split('/').pop()) : '';
        const test = e.by !== 'test' ? '' : ` ${esc(e.name)}. ${home
          ? `<a class="dref d4-file" href="#${esc(home.id)}" target="_self" data-code="${esc(e.file)}" data-find="${esc(e.name)}" title="Show this test in ${esc(e.file)}">${base}</a>`
          : `<span class="d4-file" title="${esc(e.file)}">${base}</span>`}`;
        (strong ? quiet : call)(`${label}${test}${e.note ? ` ${inl(e.note)}` : ''}`);
        warn.forEach(call);
        if (s.checks?.length) quiet(`Checks ${drefs(s.checks)}.`);
      }
    } else {
      const o = originOf(c);
      if (o?.call) call(o.html);
      cautions(c).forEach(call);
      if (c.kind === 'rule' && s.serves?.length) quiet(`Serves ${drefs(s.serves)}.`);
      if (open) {
        if (o && !o.call) quiet(o.html);
        if (c.kind === 'scenario' && s.serves?.length) quiet(`Serves ${drefs(s.serves)}.`);
        if (c.kind === 'goal' || c.kind === 'non-goal') {
          const by = servedBy(c.id), who = [...by.features.map(f => fref(f)), ...by.rules.map(x => dref(x.id))];
          if (who.length) quiet(`${c.kind === 'goal' ? 'Served by' : 'Held by'} ${who.join(', ')}.`);
        }
        if (c.kind === 'rule') { const bs = checkedBy(c.id); if (bs.length) quiet(`Checked by ${drefs(bs.map(b => b.id))}.`); }
      }
    }
    return out.join('');
  }
  const stepsHtml = (b) => {
    const rows = [['Given', b.given], ['When', b.when], ['Then', b.then]]
      .flatMap(([kw, list]) => (list || []).map((t, i) => `<div class="kw">${i ? 'and' : kw}</div><div>${inl(t)}</div>`));
    return rows.length ? `<div class="d4-steps">${rows.join('')}</div>` : '';
  };
  const libHtml = (l) => `${{ upgraded: 'Upgrades', removed: 'Removes' }[l.change] || 'Adds'} <code>${esc(l.name)}</code>${l.version ? ` ${esc(l.version)}` : ''}. ${inl(l.why)}`;
  function clauseHtml(id, cur) {
    const c = clauses.get(id), s = c.src, r = rowOf(id), d = r?.d || '', open = id === cur, shut = c.kind === 'behaviour' && !open;
    const name = clauseName(c);
    const tag = KIND[c.kind] ? `<span class="d4-id">${esc(id)}</span>` : '';
    const text = c.kind === 'behaviour'
      ? `<span class="d4-tx d4-bt">${inl(s.title)}${/[.!?]$/.test(s.title) ? '' : '.'}</span>${s.kind === 'edge' ? ' <span class="d4-case">Edge case.</span>' : s.kind === 'error' ? ' <span class="d4-case">Error case.</span>' : ''}${shut ? '' : stepsHtml(s)}`
      : `<span class="d4-tx">${c.kind === 'scenario' ? inl(s.scenario || s.title) : c.kind === 'library' ? libHtml(s) : c.kind === 'whole' ? WHOLE[c.level] : inl(s.text)}</span>`;
    const asked = d === 'change' ? `<p class="d4-asked"><b>Change requested.</b> ${esc(r.note)}</p>` : '';
    const ask = c.kind === 'whole' ? 'What is missing, or here though nobody asked for it?' : c.kind === 'scenario' ? 'What should change in this scenario?' : `What should change in ${c.kind === 'library' ? s.name : id}?`;
    const tools = submitted ? ''
      : composing === id ? `<div class="d4-compose"><textarea id="d4-note" rows="2" placeholder="${esc(ask)}">${esc(draft)}</textarea>
          <div class="row"><button type="button" class="d4-btn bad" data-act="save-ask">Request the change <kbd>${MOD}↵</kbd></button><button type="button" class="d4-btn ghost" data-act="cancel-ask">Cancel <kbd>Esc</kbd></button></div></div>`
      : open ? `<span class="d4-acts"><button type="button" data-act="ask" data-id="${esc(id)}">${d === 'change' ? 'Edit the request' : 'Request a change'}</button>${d ? `<button type="button" data-act="undo" data-id="${esc(id)}">Undo</button>` : ''}</span>`
      : '';
    const act = shut && !d ? 'pick' : 'sign';
    const says = act === 'pick' ? `Open ${name}` : d === 'ok' ? `${name} is signed. Undo` : d === 'change' ? `${name} has a change request. Edit it` : `Sign ${name}`;
    const pic = c.kind === 'behaviour' && s.screenshots ? `<div class="d4-shots">${shots(s.screenshots, true)}</div>` : '';
    return `<div class="d4-cl ${d} ${open ? 'cur' : ''}" data-item="${esc(id)}" data-act="pick" data-id="${esc(id)}">
      <div class="d4-mg"><button type="button" class="d4-sign" data-act="${act}" data-id="${esc(id)}" aria-label="${esc(says)}" title="${esc(says)}" aria-pressed="${d === 'ok'}" ${submitted ? 'disabled' : ''}>${d === 'ok' ? '✓' : d === 'change' ? '✕' : ''}</button></div>
      <div class="d4-main"><div class="commentable" data-section="${esc(id)}">${tag}${text}</div>${pic ? '' : `${asked}${tools}`}</div>
      <div class="d4-note">${noteHtml(c, open)}</div>
      ${pic}${pic && (asked || tools) ? `<div class="d4-after">${asked}${tools}</div>` : ''}
    </div>`;
  }
  function sectionHtml(level, sec, cur) {
    const f = sec.feature, more = [];
    if (f && level === '@mid') {
      const ents = (f.entities || []).filter(e => e.label);
      if (ents.length) more.push(`<p class="d4-lead">It adds or changes:</p><ul class="d4-ents">${ents.map(e => `<li><b>${esc(e.label)}</b><i>${esc(e.change || '')}</i>${inl(e.summary || '')}</li>`).join('')}</ul>`);
    }
    const wide = !f ? '' : level === '@mid' && f.screenshots ? shots(f.screenshots) : level === '@low' && (f.diagrams || []).length ? f.diagrams.map(figure).join('') : '';
    return `<section class="d4-s"><h2>${sec.n ? `${sec.n}. ` : ''}${esc(sec.title)}</h2>
      ${sec.ids.map(id => clauseHtml(id, cur)).join('') || `<p class="d4-none">${inl(sec.none || '')}</p>`}
      ${more.length ? `<div class="d4-extra">${more.join('')}</div>` : ''}
      ${wide ? `<div class="d4-wide">${wide}</div>` : ''}
      ${f ? `<p class="d4-extra"><a class="d4-link" href="#${esc(f.id)}" target="_self">${PLAN ? 'This part of the plan' : 'The code of this feature'}</a></p>` : ''}
    </section>`;
  }
  function briefHtml(level) {
    const al = data.alignment || {}, out = [];
    const call = (html) => out.push(`<p class="call">${html}</p>`), quiet = (html) => out.push(`<p>${html}</p>`);
    const derived = (al.derived || []).filter(x => x.level === (level === '@mid' ? 'mid' : 'low')).map(x => x.id);
    if (level === '@mid') {
      const rules = data.features.flatMap(f => f.rules || []);
      const decided = rules.filter(r => r.source === 'decided'), inferred = rules.filter(r => r.source === 'inferred');
      if (!ABSENT && al.unserved?.length) call(`Nothing in this PR serves ${drefs(al.unserved)}. Drop the goal, or find what is missing.`);
      else if (!ABSENT) quiet('Every goal has something here that serves it.');
      if (derived.length) call(`${derived.map(x => { const f = data.features.find(y => y.id === x); return f ? fref(f) : dref(x); }).join(', ')} ${derived.length === 1 ? 'serves' : 'serve'} no goal. Keep it, drop it, or add the goal it serves.`);
      if (decided.length) quiet(`${plural(decided.length, 'rule is', 'rules are')} the author’s own call: ${drefs(decided.map(r => r.id))}.`);
      if (inferred.length) quiet(`${plural(inferred.length, 'rule is', 'rules are')} read off the change, written down nowhere: ${drefs(inferred.map(r => r.id))}.`);
    } else if (level === '@low') {
      const ev = al.evidence || {}, n = ['test', 'stand', 'reading', 'none'].reduce((sum, k) => sum + (ev[k] || 0), 0);
      if (n) quiet(`How the ${plural(n, 'behaviour is', 'behaviours are')} known: ${ev.test || 0} by a test, ${ev.stand || 0} on a stand, ${ev.reading || 0} by reading the code, ${ev.none || 0} not covered.`);
      if (al.unchecked?.length) call(`No behaviour checks ${drefs(al.unchecked)}. Until one does, the rule is a promise.`);
      else quiet('Every rule has a behaviour that checks it.');
      if (derived.length) call(`${drefs(derived)} ${derived.length === 1 ? 'checks' : 'check'} no rule. Keep it, drop it, or add the rule above.`);
    }
    return out.join('');
  }
  function closingHtml(level) {
    const t = tallyOf(level);
    if (t.open) return '';
    const L = LEVELS.find(l => l.id === level), next = LEVELS[LEVELS.indexOf(L) + 1];
    const asks = order[level].filter(x => dec(x) === 'change'), rest = LEVELS.filter(l => tallyOf(l.id).open);
    const onward = next ? `<a class="d4-btn" href="#${next.id}" target="_self">Go on to ${next.name}</a>`
      : rest.length ? `<p>Still to read: ${rest.map(l => `<a href="#${l.id}" target="_self">${l.name}</a>`).join(', ')}.</p>`
      : SERVED && !submitted ? `<button type="button" class="d4-btn go" data-act="submit">Submit the review</button>`
      : `<p>Every level is read.</p>`;
    const below = next || !data.features.length ? '' : `<a class="d4-btn ghost" href="#${CODE}" target="_self">Read the ${codeName.toLowerCase()}</a>`;
    return `<section class="d4-closing ${t.ch ? 'has' : 'clean'}" id="closing">
      <h3>${L.name} is read: ${t.ok} signed${t.ch ? `, ${plural(t.ch, 'change')} requested` : ''}.</h3>
      ${asks.length ? `<ul>${asks.map(x => `<li><b>${esc(clauseName(clauses.get(x)))}</b>${esc(rowOf(x).note)}</li>`).join('')}</ul>` : ''}
      ${onward}${below}
    </section>`;
  }
  function levelHtml(level) {
    const L = LEVELS.find(l => l.id === level), above = LEVELS[LEVELS.indexOf(L) - 1], t = tallyOf(level), cur = at(level), p = data.purpose;
    const upper = above && state[above.id]?.decision;
    const gate = above && upper !== 'approved' ? `<p class="d4-gate">${upper === 'changes' ? `You asked for changes on ${above.name}.` : `${above.name} is not signed off yet.`} This level is read against it, so what is here may still move. <a href="#${above.id}" target="_self">Back to ${above.name}</a></p>` : '';
    const source = (s) => `<p class="d4-src ${s.read ? '' : 'unread'}"><b>${s.read ? 'Read' : 'Not read'}</b>${s.url ? `<a href="${esc(s.url)}">${esc(s.label)}</a>` : esc(s.label)}.${s.note ? ` ${inl(s.note)}` : ''}</p>`;
    const reach = data.pr.exposure ? `<p class="commentable" data-section="exposure"><span class="d4-id">Who it reaches</span>${inl(data.pr.exposure)}</p>` : '';
    const where = PLAN ? `A plan for ${esc(data.pr.repo)}, not built yet.`
      : `<a href="${esc(data.pr.url)}">${esc(data.pr.repo)}#${data.pr.number}</a>${data.pr.head ? ` at <code>${esc(data.pr.head)}</code>` : ''}${data.pr.base ? `, into <code>${esc(data.pr.base)}</code>` : ''}.`;
    const lede = level !== '@high' ? '' : `<div class="d4-lede"><p class="commentable" data-section="summary">${inl(p.summary)}</p>${p.domain ? `<p class="commentable" data-section="domain">${inl(p.domain)}</p>` : ''}${reach}${(p.sources || []).map(source).join('')}<p class="d4-src">${where}</p></div>`;
    const legend = level === '@low'
      ? 'The margin says how each behaviour is known. A note with a bar beside it needs your judgment. A behaviour shows its steps and its proof when you are on it, and you can sign it only then.'
      : 'A margin note with a bar beside it needs your judgment. The clause you are on also shows where it comes from and what it connects to.';
    const keys = submitted ? '' : `<ul class="d4-keys"><li><kbd>↵</kbd>sign and go on</li><li><kbd>X</kbd>request a change</li><li><kbd>U</kbd>undo</li><li><kbd>J</kbd><kbd>K</kbd>move down, up</li><li><kbd>N</kbd>next unsigned</li><li><kbd>F</kbd>other typeface</li></ul>`;
    const bar = submitted || !t.open ? '' : `<div class="d4-bar"><button type="button" class="d4-btn" data-act="next">Next unsigned clause <kbd>N</kbd></button><span>${t.open} of ${t.n} left</span></div>`;
    return `<div class="d4w"><article class="d4">
      <header class="d4-h"><p class="d4-lv">${L.name} level</p><h1>${esc(L.title)}</h1><p class="d4-ask">${esc(L.ask)}</p></header>
      ${gate}${lede}
      <div class="d4-front"><div class="d4-legend"><p>${legend}</p>${briefHtml(level)}</div>${keys}</div>
      ${sections[level].map(sec => sectionHtml(level, sec, cur)).join('')}
      ${entry(level).comments.length ? `<section class="d4-comments"><h2>Comments</h2>${commentList({ id: level }, 'level')}</section>` : ''}
      ${closingHtml(level)}
    </article>${bar}</div>`;
  }

  const pop = document.getElementById('pop');
  function showPop(b) {
    const id = b.dataset.go, it = items.get(id);
    if (!it || 'quiet' in b.dataset) return;
    const f = it.kind === 'feature' && data.features.find(x => x.id === id);
    pop.innerHTML = `<b>${f ? `Scenario ${data.features.indexOf(f) + 1}` : `${KIND[it.kind]} ${esc(id)}`}</b>${inl(f ? f.scenario || f.title : it.text)}`;
    pop.hidden = false;
    const r = b.getBoundingClientRect(), below = r.bottom + 8 + pop.offsetHeight <= innerHeight;
    pop.style.left = `${Math.max(12, Math.min(innerWidth - pop.offsetWidth - 12, r.left))}px`;
    pop.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - pop.offsetHeight - 8)}px`;
  }
  for (const [on, off] of [['mouseover', 'mouseout'], ['focusin', 'focusout']]) {
    main.addEventListener(on, (e) => { const b = e.target.closest?.('.d4 [data-go]'); if (b) showPop(b); });
    main.addEventListener(off, (e) => { if (e.target.closest?.('.d4 [data-go]')) pop.hidden = true; });
  }

  const clauseEl = (id) => id ? main.querySelector(`[data-item="${CSS.escape(id)}"]`) : null;
  const inView = (id) => { const box = clauseEl(id)?.getBoundingClientRect(); return !!box && box.top >= 0 && box.top < innerHeight - 110; };
  function drawLevel(how, anchor) {
    const level = shownId, top = clauseEl(anchor)?.getBoundingClientRect().top;
    pop.hidden = true;
    main.innerHTML = levelHtml(level);
    main.querySelector('.d4w').onclick = levelClick;
    drawFigures();
    const note = document.getElementById('d4-note');
    if (note) {
      note.oninput = () => { draft = note.value; };
      note.focus({ preventScroll: true });
      note.setSelectionRange(note.value.length, note.value.length);
    }
    highlight({ id: level });
    const now = clauseEl(anchor);
    if (how === 'closing') main.querySelector('#closing')?.scrollIntoView({ block: 'center' });
    else if (how === 'center') now?.scrollIntoView({ block: 'center' });
    else if (now && top !== undefined) scrollBy(0, now.getBoundingClientRect().top - top);
  }
  function decide(id, record, viaKey) {
    const c = clauses.get(id), ids = order[c.level];
    (entry(c.level).rows ||= {})[id] = { ...record, hash: clauseHash(c), seen: clauseText(c), at: Date.now() };
    composing = null;
    const open = (x) => x !== id && !dec(x);
    const next = ids.slice(ids.indexOf(id) + 1).find(open) || ids.find(open);
    cursor[c.level] = next || id;
    settleLevel(c.level); save(); renderNav();
    drawLevel(!next ? 'closing' : viaKey ? 'center' : 'anchor', viaKey ? next : id);
  }
  function undo(id) {
    const level = clauses.get(id).level;
    delete entry(level).rows?.[id];
    composing = null; cursor[level] = id;
    settleLevel(level); save(); renderNav();
    drawLevel('anchor', id);
  }
  function ask(id) {
    const level = clauses.get(id).level, shown = inView(id);
    if (composing !== id) draft = rowOf(id)?.note || '';
    cursor[level] = id; composing = id;
    drawLevel(shown ? 'anchor' : 'center', id);
  }
  function saveAsk(viaKey) {
    const note = document.getElementById('d4-note');
    if (!composing || !note) return;
    const text = note.value.trim();
    if (!text) { note.placeholder = 'Say what should change, then save.'; note.focus(); return; }
    decide(composing, { d: 'change', note: text }, viaKey);
  }
  function cancelAsk() { const id = composing; composing = null; drawLevel('anchor', id); }
  function pick(id, viaKey) {
    cursor[clauses.get(id).level] = id; composing = null;
    drawLevel(viaKey ? 'center' : 'anchor', id);
  }
  function move(step) {
    const ids = order[shownId], i = ids.indexOf(at(shownId));
    pick(ids[Math.max(0, Math.min(ids.length - 1, i + step))], true);
  }
  function nextOpen() {
    const ids = order[shownId], id = at(shownId), open = (x) => !dec(x);
    const next = open(id) && !inView(id) ? id : ids.slice(ids.indexOf(id) + 1).find(open) || ids.find(open);
    if (next) pick(next, true);
  }
  let pendingCode = null;
  function goCode(id, path, find) {
    pendingCode = { id, path, find };
    current = CODE; location.hash = CODE; render();
  }
  function levelClick(e) {
    const ref = e.target.closest('[data-go]');
    if (ref) { e.preventDefault(); const it = items.get(ref.dataset.go); if (it) go(it.level, ref.dataset.go); return; }
    const code = e.target.closest('[data-code]');
    if (code) { e.preventDefault(); goCode(code.getAttribute('href').slice(1), code.dataset.code, code.dataset.find); return; }
    const del = e.target.closest('[data-del]');
    if (del) { const cs = entry(shownId).comments; cs.splice(cs.findIndex(c => c.id === del.dataset.del), 1); save(); render(); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (e.target.closest('.d4-compose') && !b.closest('.d4-compose')) return;
    if (act === 'pick') { if (!String(getSelection()) && !e.target.closest('a') && id !== at(shownId)) pick(id); return; }
    if (act === 'next') return nextOpen();
    if (submitted) return;
    if (act === 'sign') return dec(id) === 'ok' ? undo(id) : dec(id) === 'change' ? ask(id) : decide(id, { d: 'ok' });
    if (act === 'ask') return ask(id);
    if (act === 'undo') return undo(id);
    if (act === 'save-ask') return saveAsk();
    if (act === 'cancel-ask') return cancelAsk();
    if (act === 'submit') return document.getElementById('submit').click();
  }
  const onLevel = () => LAYERED && current.startsWith('@') && shownId === current && !focusOpen() && zoom.hidden;
  function levelKey(e) {
    const t = e.target;
    if (shownId === CODE) return codeKey(e);
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) {
      if (t.id !== 'd4-note' || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return false;
      e.preventDefault(); saveAsk(true);
      return true;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, id = at(shownId);
    const acts = k === 'Enter' || k === 'x' || k === 'u';
    if (k === 'Enter' && t.closest?.('button, a, summary')) return false;
    if (k === 'j') move(1);
    else if (k === 'k') move(-1);
    else if (k === 'n') nextOpen();
    else if (k === 'f') toggleFace();
    else if (!acts || submitted) return false;
    else if (!inView(id)) pick(id, true);
    else if (k === 'Enter') dec(id) ? nextOpen() : decide(id, { d: 'ok' }, true);
    else if (k === 'x') ask(id);
    else if (dec(id)) undo(id);
    e.preventDefault();
    return true;
  }

  function reveal() {
    if (!pendingItem) return;
    const el = clauseEl(pendingItem);
    pendingItem = null;
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  function go(id, item) {
    pendingItem = item || null;
    if (current !== id || shownId !== id) { current = id; location.hash = id; return; }
    render();
  }
  function bindRefs(root) {
    root.querySelectorAll('[data-go]').forEach(b => b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const it = items.get(b.dataset.go); if (it) go(it.level, b.dataset.go); });
  }

  function renderLevel(id) {
    const arriving = shownId !== id;
    shownId = id;
    if (arriving) composing = null;
    if (pendingItem && clauses.get(pendingItem)?.level === id) { cursor[id] = pendingItem; composing = null; }
    drawLevel();
    if (arriving && !pendingItem) scrollTo(0, 0);
    reveal();
  }

  // ---- feature panel
  let noting = null;
  let renderCount = 0;
  const featureOf = (id) => data.features.find(x => x.id === id);
  const shownFiles = (f) => { const { groups, flat } = reading(f); return groups.length > 1 ? flat : f.files || []; };
  const unitKey = (f, file) => `${data.features.indexOf(f)}:${file ? shownFiles(f).indexOf(file) : 'v'}`;
  const unitOf = (key) => { const [i, j] = key.split(':'), f = data.features[+i]; return { f, file: j === 'v' ? null : shownFiles(f)[+j] }; };
  let codeUnits = null;
  const codeOrder = () => codeUnits ||= data.features.flatMap(f => [...shownFiles(f).map(file => unitKey(f, file)), unitKey(f)]);
  const unitOpen = (key) => { const { f, file } = unitOf(key); return file ? !isViewed(f, file) : !state[f.id]?.decision; };
  const unitEl = (key) => key ? main.querySelector(`[data-unit="${key}"]`) : null;
  const unitInView = (key) => { const box = unitEl(key)?.getBoundingClientRect(); return !!box && box.bottom > 60 && box.top < innerHeight - 110; };
  const codeAt = () => {
    const ids = codeOrder();
    if (!ids.includes(cursor[CODE])) cursor[CODE] = ids.find(unitOpen) || ids[0];
    return cursor[CODE];
  };
  const decideFeature = (f, decision, note = state[f.id]?.note || '') => {
    Object.assign(entry(f.id), { decision, note, at: Date.now(), head: data.pr.head || 'plan', seen: shot(f) });
    noting = null; save(); render();
  };
  const undecideFeature = (f) => { const e = entry(f.id); delete e.decision; delete e.at; delete e.head; noting = null; save(); render(); };
  const writeNote = (f, as) => { noting = { id: f.id, as, draft: state[f.id]?.note || '' }; render(); };
  const saveNote = (f) => {
    const text = main.querySelector('#d4-note').value.trim();
    if (noting.as === 'changes') return decideFeature(f, 'changes', text);
    entry(f.id).note = text; noting = null; save(); render();
  };

  function featureView(f, doc) {
    const st = state[f.id] || {}, v = viewedCount(f), ch = sinceOf(f), upd = changedSince(f);
    const { groups, flat } = reading(f);
    const block = (file) => fileBlock(f, file, doc && unitKey(f, file), doc?.cur);
    const files = groups.length > 1
      ? groups.map(g => `<div class="fgroup">${esc(g.label)}<span>${g.files.length}</span></div>${g.files.map(block).join('')}`).join('')
      : (f.files || []).map(block).join('');
    const when = ch.at ? new Date(ch.at).toLocaleString() : '';
    const told = (k) => k in ch.text && !(LAYERED && k === 'scenario');
    const bits = [
      ...['scenario', 'description', 'tested'].filter(told).map(k => ({ scenario: 'the scenario', description: 'what changed', tested: 'how it was tested' })[k]),
      ...(ch.diagrams && !LAYERED ? ['the diagrams'] : []),
      ...(ch.entities.size ? [`${ch.entities.size} entit${ch.entities.size === 1 ? 'y' : 'ies'}`] : []),
      ...(upd.length ? [`${upd.length} reworked file${upd.length === 1 ? '' : 's'}`] : []),
      ...(ch.newFiles?.length ? [`${ch.newFiles.length} file${ch.newFiles.length === 1 ? '' : 's'} not there before`] : []),
    ];
    const reworded = ['scenario', 'description', 'tested'].some(told);
    const bar = ch.any && bits.length ? `<div class="since">
      <span class="what"><b>Reworked since you looked${when ? ` on ${esc(when)}` : ''}:</b> ${esc(bits.join(', '))}.</span>
      <span class="ctl">${reworded ? `<label class="hl"><input type="checkbox" ${showDiff ? 'checked' : ''}>Show what it said before</label>` : ''}<button class="seen" type="button" title="Take everything ${doc ? 'in this feature' : 'on this page'} as your new starting point">Mark as seen</button></span>
    </div>` : '';
    const blocks = (html) => { const t = document.createElement('template'); t.innerHTML = html; return [...t.content.children]; };
    const plain = (el) => el.textContent.replace(/\s+/g, ' ').trim();
    // What a reworked passage said beside what it says, each rendered as the page renders it. A word-level
    // diff of a rewrite interleaves two texts into one that reads as neither.
    const reworked = (k, html) => {
      if (!(k in ch.text)) return { body: html, mark: '', note: '' };
      if (!showDiff) return { body: html, mark: '', note: '<p class="call">Reworded since you looked.</p>' };
      const before = ch.text[k] || '', said = '<p class="call">Reworded since you looked. It said:</p>';
      if (k === 'scenario') return { body: html, mark: ' moved', note: `${said}<div class="d4-was"><p>${before ? inl(before) : 'Nothing.'}</p></div>` };
      const was = blocks(md(before)), now = blocks(html), old = new Set(was.map(plain)), cur = new Set(now.map(plain));
      now.forEach(el => { if (!old.has(plain(el))) el.classList.add('moved'); });
      const gone = was.filter(el => !cur.has(plain(el)));
      return { body: now.map(el => el.outerHTML).join('\n'), mark: '',
        note: gone.length ? `${said}<div class="d4-was">${gone.map(el => el.outerHTML).join('\n')}</div>` : '<p class="call">Added since you looked. The new passages are marked.</p>' };
    };
    const row = (cls, k, html) => { const r = reworked(k, html); return `<div class="d4-row"><div class="${cls}${r.mark} commentable" data-section="${k}">${r.body}</div><div class="d4-note">${r.note}</div></div>`; };
    const d = st.decision === 'approved' ? 'ok' : st.decision === 'changes' ? 'change' : '', writing = noting?.id === f.id;
    const claim = PLAN ? 'This part of the plan is ready to build.' : LAYERED ? 'The code of this feature is ready to merge.' : 'This feature is ready to merge.';
    const noted = d === 'change' ? `<p class="d4-asked"><b>Changes requested.</b> ${esc(st.note || '')}</p>` : st.note ? `<p class="d4-said"><b>Your note.</b> ${esc(st.note)}</p>` : '';
    const tools = submitted ? '' : writing
      ? `<div class="d4-compose"><textarea id="d4-note" rows="2" placeholder="${PLAN ? 'What the plan should do differently' : 'Note for the author'} (optional)">${esc(noting.draft)}</textarea>
          <div class="row"><button type="button" class="d4-btn ${noting.as === 'changes' ? 'bad' : ''}" data-say="save">${noting.as !== 'changes' ? 'Save the note' : LAYERED ? 'Request the change' : 'Request changes'} <kbd>${MOD}↵</kbd></button><button type="button" class="d4-btn ghost" data-say="cancel">Cancel <kbd>Esc</kbd></button></div></div>`
      : `<span class="d4-acts"><button type="button" data-say="changes">${d === 'change' ? 'Edit the request' : LAYERED ? 'Request a change' : 'Request changes'}</button>${d === 'change' ? '' : `<button type="button" data-say="note">${st.note ? 'Edit the note' : 'Add a note'}</button>`}${d ? '<button type="button" data-say="undo">Undo</button>' : ''}</span>`;
    const says = d === 'ok' ? 'Approved. Undo' : d === 'change' ? 'Changes requested. Edit the request' : PLAN ? 'Approve this part of the plan' : 'Approve this feature';
    const decided = st.decision ? `Decided ${new Date(st.at).toLocaleString()}${st.head === 'plan' && !PLAN ? ' on the plan' : st.head && st.head !== data.pr.head ? ` at ${st.head.slice(0, 7)}` : ''}.` : '';
    const unit = doc ? unitKey(f) : '';
    const verdict = `<div class="d4-cl verdict ${d}${unit && unit === doc.cur ? ' cur' : ''}"${unit ? ` data-unit="${unit}"` : ''}>
      <div class="d4-mg"><button type="button" class="d4-sign" aria-pressed="${d === 'ok'}" aria-label="${says}" title="${says}" ${submitted ? 'disabled' : ''}>${d === 'ok' ? '✓' : d === 'change' ? '✕' : ''}</button></div>
      <div class="d4-main"><span class="d4-tx">${claim}</span>${noted}${tools}</div>
      <div class="d4-note">${st.decision && upd.length ? `<p class="call"><b>${plural(upd.length, 'file')} changed since you decided.</b> Decide again.</p>` : ''}${decided ? `<p>${decided}</p>` : ''}</div>
    </div>`;
    return { v, ch, flat, files, bar, row, told, verdict };
  }

  function bindFeature(root, f) {
    const st = state[f.id] || {}, inDoc = root !== main;
    const say = { changes: () => writeNote(f, 'changes'), note: () => writeNote(f, 'note'), undo: () => undecideFeature(f), save: () => saveNote(f), cancel: () => { noting = null; render(); } };
    root.querySelector('.verdict .d4-sign').onclick = () => {
      if (inDoc) cursor[CODE] = !st.decision && codeAfter(unitKey(f)) || unitKey(f);
      return !st.decision ? decideFeature(f, 'approved') : st.decision === 'approved' ? undecideFeature(f) : writeNote(f, 'changes');
    };
    root.querySelectorAll('[data-say]').forEach(b => b.onclick = say[b.dataset.say]);
    const note = root.querySelector('#d4-note');
    if (note) {
      note.oninput = () => { noting.draft = note.value; };
      note.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(f); } };
      note.focus({ preventScroll: true });
      note.setSelectionRange(note.value.length, note.value.length);
    }
    root.querySelectorAll('.file > .fh').forEach(h => h.onclick = () => {
      const file = f.files.find(x => x.path === h.parentElement.dataset.path);
      (expanded[f.id] ||= new Map()).set(file.path, !isOpen(f, file)); render();
    });
    root.querySelectorAll('.file .fv').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const file = f.files.find(x => x.path === b.closest('.file').dataset.path);
      if (inDoc) cursor[CODE] = !isViewed(f, file) && codeAfter(unitKey(f, file)) || unitKey(f, file);
      toggleViewed(f, file);
    });
    if (LAYERED) root.querySelectorAll('.file .also a').forEach(a => a.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      goCode(a.getAttribute('href').slice(1), a.closest('.file').dataset.path);
    });
    const hl = root.querySelector('.since .hl input');
    if (hl) hl.onchange = () => { showDiff = hl.checked; render(); };
    const seenBtn = root.querySelector('.since .seen');
    if (seenBtn) seenBtn.onclick = () => { entry(f.id).seen = shot(f); save(); render(); };
    root.querySelectorAll('.focusbtn, [data-focus]').forEach(b => b.onclick = () => openFocus(f));
    root.querySelectorAll('.dl').forEach(line => line.onclick = () => { if (!submitted) openLineComposer(f, line); });
    bindRendered(root, f, render);
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = (e) => {
      e.stopPropagation(); const cs = entry(f.id).comments; cs.splice(cs.findIndex(c => c.id === b.dataset.del), 1); save(); render();
    });
    root.querySelectorAll('.examples .tabs button').forEach(b => b.onclick = () => {
      const box = b.closest('.examples');
      exampleShown.set(`${f.id}\n${box.dataset.entity}`, +b.dataset.ex);
      box.querySelectorAll('.tabs button').forEach(t => t.classList.toggle('on', t === b));
      box.querySelectorAll('.ex').forEach(x => x.hidden = x.dataset.ex !== b.dataset.ex);
      editors.forEach(kept => kept.ed.layout());
    });
    highlight(f, root);
    markPhrases(root, f);
    bindRefs(root);
  }

  function featureSection(f, i, cur) {
    const w = featureView(f, { cur }), rules = f.rules || [], cases = f.behaviours || [];
    const behind = [rules.length ? dref(f.id, plural(rules.length, 'rule'), true) : '', cases.length ? dref(cases[0].id, plural(cases.length, 'behaviour'), true) : ''].filter(Boolean);
    const sub = [
      behind.length ? `Behind ${behind.join(' and ')}.` : '',
      w.v.total ? `<span class="${w.v.seen === w.v.total ? 'all' : ''}">${w.v.seen} of ${plural(w.v.total, 'file')} viewed.</span>${w.flat.length ? ' <button type="button" class="focusbtn">Focus review</button>' : ''}` : '',
    ].filter(Boolean).join(' ');
    return `<section class="d4-s d4-feat" data-feature="${esc(f.id)}">
      <h2>${i + 1}. ${esc(f.title)}</h2>
      ${w.bar}
      ${sub ? `<p class="d4-sub">${sub}</p>` : ''}
      ${w.row('d4-prose', 'description', md(f.description))}
      ${(f.entities || []).length ? `<h3>Entities</h3>${entities(f)}` : ''}
      ${w.files ? `<div class="d4-files">${w.files}</div>` : ''}
      ${f.tested || w.told('tested') ? `<h3>How it ${PLAN ? 'will be' : 'was'} tested</h3>${w.row('d4-prose', 'tested', md(f.tested) || '<p class="none">Not stated.</p>')}` : ''}
      ${entry(f.id).comments.length ? `<div class="d4-comments"><h2>Comments</h2>${commentList(f)}</div>` : ''}
      ${w.verdict}
    </section>`;
  }
  function codeClosing() {
    if (codeOrder().some(unitOpen)) return '';
    const asks = data.features.filter(f => state[f.id]?.decision === 'changes'), ok = data.features.length - asks.length;
    const rest = LEVELS.filter(l => tallyOf(l.id).open);
    const onward = rest.length ? `<p>Still to read: ${rest.map(l => `<a href="#${l.id}" target="_self">${l.name}</a>`).join(', ')}.</p>`
      : SERVED && !submitted ? `<button type="button" class="d4-btn go" data-act="submit">Submit the review</button>`
      : '';
    return `<section class="d4-closing ${asks.length ? 'has' : 'clean'}" id="closing">
      <h3>The ${codeName.toLowerCase()} is read: ${ok} signed${asks.length ? `, ${plural(asks.length, 'change')} requested` : ''}.</h3>
      ${asks.length ? `<ul>${asks.map(f => `<li><b>${esc(f.title)}</b>${esc(state[f.id].note || '')}</li>`).join('')}</ul>` : ''}
      ${onward}
    </section>`;
  }
  function codeHtml() {
    const cur = codeAt(), fs = data.features, counts = fs.map(viewedCount), part = PLAN ? 'part' : 'feature';
    const total = counts.reduce((n, v) => n + v.total, 0), seen = counts.reduce((n, v) => n + v.seen, 0);
    const unsigned = fs.filter(f => !state[f.id]?.decision).length;
    const legend = `${submitted ? '' : `<p>Select any text to comment on it${total ? ', or click a line of the diff' : ''}.</p>`}
      <p>Reading this is optional: the review is decided on the levels. A change requested here still sends it back.</p>`;
    const keys = submitted ? '' : `<ul class="d4-keys"><li><kbd>↵</kbd>tick and go on</li><li><kbd>C</kbd>comment on the file</li><li><kbd>X</kbd>request a change</li><li><kbd>U</kbd>undo</li><li><kbd>J</kbd><kbd>K</kbd>move down, up</li><li><kbd>N</kbd>next unread</li><li><kbd>F</kbd>other typeface</li></ul>`;
    const bar = submitted || !codeOrder().some(unitOpen) ? '' : `<div class="d4-bar"><button type="button" class="d4-btn" data-act="next">${seen < total ? 'Next unread' : 'Next unsigned'} <kbd>N</kbd></button><span>${seen < total ? `${total - seen} of ${total} files left` : `${plural(unsigned, part)} left to sign`}</span></div>`;
    return `<div class="d4w"><article class="d4 d4-code d4-all">
      <header class="d4-h"><p class="d4-lv">${codeName}</p><h1>${PLAN ? 'How it will be built' : 'What was written'}</h1><p class="d4-ask">${PLAN ? 'Is this how it should be built?' : 'Does the code do what the levels say?'}</p></header>
      <div class="d4-front"><div class="d4-legend">${legend}</div>${keys}</div>
      ${fs.map((f, i) => featureSection(f, i, cur)).join('')}
      ${codeClosing()}
    </article>${bar}</div>`;
  }

  let codeShow = null;
  const sectionOf = (id) => [...main.querySelectorAll('.d4-feat')].find(x => x.dataset.feature === id);
  const keepSpot = () => {
    const el = [...main.querySelectorAll('[data-unit], .d4-feat > h2')].find(x => x.getBoundingClientRect().bottom > 0);
    if (!el) return () => {};
    const top = el.getBoundingClientRect().top, unit = el.dataset.unit, id = el.closest('.d4-feat').dataset.feature;
    return () => {
      const now = unit ? unitEl(unit) : sectionOf(id)?.querySelector('h2');
      if (now) scrollBy(0, now.getBoundingClientRect().top - top);
    };
  };
  const showUnit = (key) => { const el = unitEl(key); el?.scrollIntoView({ block: el.querySelector('.fbody') ? 'start' : 'center' }); };
  function markCursor(key) {
    cursor[CODE] = key;
    main.querySelectorAll('[data-unit].cur').forEach(el => el.classList.remove('cur'));
    unitEl(key)?.classList.add('cur');
  }
  function renderCode(turn) {
    const arriving = shownId !== CODE, want = pendingCode, show = codeShow;
    pendingCode = null; codeShow = null;
    shownId = CODE;
    pop.hidden = true;
    const target = want && featureOf(want.id), sought = target && want.path ? (target.files || []).find(x => x.path === want.path) : null;
    if (sought) { (expanded[target.id] ||= new Map()).set(sought.path, true); cursor[CODE] = unitKey(target, sought); }
    const settle = arriving || target || show ? null : keepSpot();
    main.innerHTML = codeHtml();
    main.querySelector('.d4w').onclick = codeClick;
    main.querySelectorAll('.d4-feat').forEach(sec => bindFeature(sec, featureOf(sec.dataset.feature)));
    const place = () => {
      if (target) {
        const el = sought ? unitEl(unitKey(target, sought)) : null;
        const line = el && want.find && [...el.querySelectorAll('.dl:not(.del) .code')].find(c => c.textContent.includes(want.find))?.parentElement;
        line?.classList.add('found');
        (line || el || sectionOf(target.id))?.scrollIntoView({ block: line ? 'center' : 'start' });
      } else if (show === 'closing') main.querySelector('#closing')?.scrollIntoView({ block: 'center' });
      else if (show) showUnit(show);
      else if (arriving) scrollTo(0, 0);
      else settle();
      return scrollY;
    };
    const mount = () => mountEditors(data.features.map(f => [f, sectionOf(f.id)]).filter(([, sec]) => sec));
    mount();
    const placed = place();
    if (!monacoApi) monacoReady.then(() => {
      if (turn !== renderCount) return;
      mount();
      if (target && Math.abs(scrollY - placed) < 2) place();
    });
  }
  function arrive(key) {
    const { f, file } = unitOf(key);
    cursor[CODE] = key; codeShow = key;
    if (!file || isViewed(f, file) || !file.hunks?.length || isOpen(f, file)) return false;
    (expanded[f.id] ||= new Map()).set(file.path, true);
    return true;
  }
  function codePick(key) {
    if (arrive(key)) return render();
    codeShow = null;
    markCursor(key); showUnit(key);
  }
  function codeMove(step) {
    const ids = codeOrder(), i = ids.indexOf(codeAt());
    codePick(ids[Math.max(0, Math.min(ids.length - 1, i + step))]);
  }
  function codeNext() {
    const ids = codeOrder(), key = codeAt();
    const next = unitOpen(key) && !unitInView(key) ? key : ids.slice(ids.indexOf(key) + 1).find(unitOpen) || ids.find(unitOpen);
    if (next) codePick(next);
  }
  const codeAfter = (key) => { const ids = codeOrder(); return ids.slice(ids.indexOf(key) + 1).find(unitOpen) || ids.find(x => x !== key && unitOpen(x)); };
  function codeDone(key) {
    const { f, file } = unitOf(key), next = codeAfter(key);
    if (next) arrive(next); else codeShow = 'closing';
    if (file) toggleViewed(f, file, true); else decideFeature(f, 'approved');
  }
  function codeUndo(key) {
    const { f, file } = unitOf(key);
    if (!file) { if (state[f.id]?.decision) undecideFeature(f); }
    else if (isViewed(f, file)) toggleViewed(f, file, false);
  }
  function codeSay(key, as) {
    const { f, file } = unitOf(key);
    if (!file || as === 'changes') { cursor[CODE] = codeShow = unitKey(f); return writeNote(f, as); }
    const c = makeComposer('', (body) => { entry(f.id).comments.push({ id: uid(), kind: 'file', file: file.path, body, at: Date.now() }); save(); render(); });
    unitEl(key).querySelector('.fh').insertAdjacentElement('afterend', c);
    c.querySelector('textarea').focus();
  }
  function codeClick(e) {
    const b = e.target.closest('[data-act]');
    if (b?.dataset.act === 'next') { b.blur(); return codeNext(); }
    if (b?.dataset.act === 'submit') return document.getElementById('submit').click();
    if (e.target.closest('.d4-sign')) return;
    const unit = e.target.closest('[data-unit]')?.dataset.unit;
    if (unit && unit !== cursor[CODE] && !String(getSelection())) markCursor(unit);
  }
  function codeKey(e) {
    const t = e.target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, key = codeAt();
    if (k === 'Enter' && t.closest?.('button, a, summary')) return false;
    if (k === 'j') codeMove(1);
    else if (k === 'k') codeMove(-1);
    else if (k === 'n') codeNext();
    else if (k === 'f') toggleFace();
    else if (!['Enter', 'x', 'c', 'u'].includes(k) || submitted) return false;
    else if (!unitInView(key)) codePick(key);
    else if (k === 'Enter') unitOpen(key) ? codeDone(key) : codeNext();
    else if (k === 'u') codeUndo(key);
    else codeSay(key, k === 'x' ? 'changes' : 'note');
    e.preventDefault();
    return true;
  }

  function render() {
    const turn = ++renderCount;
    if (LAYERED) {
      const f = featureOf(current);
      if (f) { pendingCode ||= { id: f.id }; current = CODE; history.replaceState(null, '', `#${CODE}`); }
      if (!LEVELS.some(l => l.id === current) && !(current === CODE && data.features.length)) current = LEVELS[0].id;
    }
    if (noting && noting.id !== current && current !== CODE) noting = null;
    renderNav();
    closeComposer();
    if (LAYERED && current === CODE) return renderCode(turn);
    if (LAYERED) return renderLevel(current);
    const f = featureOf(current) || data.features[0];
    if (!f) { main.innerHTML = '<p class="none">No features in review.json.</p>'; return; }
    if (shownId !== f.id) scrollTo(0, 0);
    shownId = f.id;
    const w = featureView(f, null), nth = data.features.indexOf(f), total = data.features.length;
    const section = (title, body, sub = '') => `<section class="d4-s"><h2>${title}</h2>${sub}${body}</section>`;
    const legend = submitted ? '' : `<p>Select any text to comment on it${w.flat.some(x => x.hunks?.length) ? ', or click a line of the diff' : ''}.</p>`;
    const sub = w.v.total ? `<p class="d4-sub"><span class="${w.v.seen === w.v.total ? 'all' : ''}">${w.v.seen} of ${w.v.total} viewed.</span> Tick a file when you have read it.${w.flat.length ? ' <button type="button" class="focusbtn">Focus review</button> shows one file at a time.' : ''}</p>` : '';
    const foot = submitted || !w.v.total || !w.flat.length ? '' : `<div class="d4-bar">${w.v.seen < w.v.total
      ? `<button type="button" class="d4-btn" data-focus>Read the next unviewed file</button><span>${w.v.total - w.v.seen} of ${w.v.total} left</span>`
      : '<span class="done">Every file is viewed.</span>'}</div>`;

    main.innerHTML = `<div class="d4w"><article class="d4 d4-code" data-feature="${esc(f.id)}">
      <header class="d4-h"><p class="d4-lv">${PLAN ? 'Plan, part' : 'Feature'} ${nth + 1} of ${total}</p><h1>${esc(f.title)}</h1><p class="d4-ask">${PLAN ? 'Is this the right thing to build, before any code is written?' : 'Is this the right change, built the right way?'}</p></header>
      ${w.bar}
      ${legend ? `<div class="d4-front"><div class="d4-legend">${legend}</div></div>` : ''}
      ${section('User scenario', w.row('d4-statement', 'scenario', inl(f.scenario || '')))}
      ${section('What changed', w.row('d4-prose', 'description', md(f.description)))}
      ${section('Entities', entities(f))}
      ${section('Architecture', (f.diagrams || []).length ? `<div class="d4-wide">${f.diagrams.map(figure).join('')}</div>` : '<p class="d4-none">No flow or boundary change, so no diagram.</p>', w.ch.diagrams ? '<p class="d4-sub call">Redrawn since you looked.</p>' : '')}
      ${section('Before and after', f.screenshots ? `<div class="d4-wide">${shots(f.screenshots)}</div>` : '<p class="d4-none">No user-visible surface, so no screenshots.</p>')}
      ${section(PLAN ? 'Files' : 'Diff', w.files || `<p class="d4-none">${PLAN ? 'Not written yet. The plan above is what you are approving.' : 'No files listed.'}</p>`, sub)}
      ${section(`How it ${PLAN ? 'will be' : 'was'} tested`, w.row('d4-prose', 'tested', md(f.tested) || '<p class="none">Not stated.</p>'))}
      ${entry(f.id).comments.length ? `<section class="d4-comments"><h2>Comments</h2>${commentList(f)}</section>` : ''}
      ${section('Your decision', w.verdict)}
    </article>${foot}</div>`;
    bindFeature(main, f);
    drawFigures();
    monacoReady.then(() => { if (turn === renderCount) mountEditors([[f, main]]); });
  }

  // ---- full-screen diagram
  const zoom = document.getElementById('zoom');
  function openZoom(box) {
    const shot = box.matches('img'), art = shot ? box : box.querySelector('svg');
    if (!art) return;
    zoom.querySelector('.body').replaceChildren(art.cloneNode(true));
    const said = shot ? box.parentElement.querySelector('.label') || box.closest('.shots').nextElementSibling : box.parentElement.querySelector('figcaption');
    zoom.querySelector('.cap').textContent = said?.matches('.label, figcaption') ? said.textContent : '';
    zoom.hidden = false;
    document.body.classList.add('zoomed');
    zoom.querySelector('.close').focus();
  }
  function closeZoom() {
    if (zoom.hidden) return;
    zoom.hidden = true;
    document.body.classList.remove('zoomed');
    zoom.querySelector('.body').replaceChildren();
  }
  zoom.querySelector('.close').onclick = closeZoom;
  zoom.onclick = (e) => { if (e.target === zoom) closeZoom(); };
  main.addEventListener('click', (e) => { const box = e.target.closest('.diagram:not(.pending), .shots img'); if (box) openZoom(box); });

  // ---- reading order: what a reviewer should meet first. The domain types a feature declares come
  // first (they name everything downstream), then what stores them, then the logic, the edges it is
  // reached through, the surface, and last the tests and generated files that only confirm the rest.
  /** The feature's files, grouped and flattened into the order the rail and the arrows follow. */
  const readings = new WeakMap();
  function reading(f) {
    if (readings.has(f)) return readings.get(f);
    const files = f.files || [];
    const groups = (data.groups || []).map(([key, label]) => ({ key, label, files: files.filter(x => (x.group || 'other') === key) })).filter(g => g.files.length);
    readings.set(f, { groups, flat: groups.flatMap(g => g.files) });
    return readings.get(f);
  }

  // ---- focus review: one file at a time, full screen, in that order
  const focus = document.getElementById('focus');
  let focusFeature = null;
  let focusAt = -1;                                 // index into reading(focusFeature).flat, -1 when closed
  let focusShown = null;                            // the file the panel last drew, so a redraw of it keeps its scroll
  const focusOpen = () => focusAt >= 0;
  function openFocus(f, index) {
    const { flat } = reading(f);
    if (!flat.length) return;
    focusFeature = f;
    const firstUnseen = flat.findIndex(x => !isViewed(f, x));
    focusAt = index ?? (firstUnseen < 0 ? 0 : firstUnseen);
    focus.hidden = false;
    document.body.classList.add('zoomed');
    renderFocus();
  }
  function closeFocus() {
    if (!focusOpen()) return;
    focusAt = -1; focusShown = null; focus.hidden = true; focus.querySelector('.code').replaceChildren();
    document.body.classList.remove('zoomed');
    render();
  }
  function goFocus(step) {
    const f = focusFeature;
    const { flat } = reading(f);
    const next = focusAt + step;
    if (next < 0 || next >= flat.length) return closeFocus();   // off either end: back to the feature
    focusAt = next; renderFocus();
  }
  function renderFocus() {
    if (!focusOpen()) return;
    const f = focusFeature;
    const { groups, flat } = reading(f);
    const file = flat[focusAt];
    if (!file) return closeFocus();
    const seen = flat.filter(x => isViewed(f, x)).length;
    focus.querySelector('.rtitle').textContent = f.title;
    focus.querySelector('.rcount').textContent = `${seen} of ${flat.length} viewed`;
    focus.querySelector('.progress span').style.width = `${Math.round((seen / flat.length) * 100)}%`;
    focus.querySelector('.pos').textContent = `${focusAt + 1} of ${flat.length}`;
    focus.querySelector('.path').innerHTML = pathHtml(file.path);
    focus.querySelector('.path').title = file.path;
    const fch = sinceOf(f).files[file.path];
    focus.querySelector('.newly').textContent = fch ? (fch.added != null ? `${fch.added} new line${fch.added === 1 ? '' : 's'} since you looked` : 'reworked since you looked') : '';
    focus.querySelector('.newly').hidden = !fch;
    focus.querySelector('.good').innerHTML = `${isViewed(f, file) ? 'Viewed ✓' : 'Mark as viewed'} <kbd>↵</kbd>`;
    focus.querySelector('.good').hidden = submitted;
    focus.querySelector('.say').hidden = submitted;
    focus.querySelector('.good').classList.toggle('on', isViewed(f, file));

    const rail = focus.querySelector('.rlist');
    rail.innerHTML = groups.map(g => `<div class="rgroup"><div class="glabel">${esc(g.label)}</div>${g.files.map(x => {
      const i = flat.indexOf(x);
      const n = entry(f.id).comments.filter(c => (c.kind === 'line' || c.kind === 'file') && c.file === x.path).length;
      const ch = sinceOf(f).files[x.path];
      return `<button data-i="${i}" class="${i === focusAt ? 'on' : ''} ${isViewed(f, x) ? 'seen' : ''}">
        <span class="nb ${isViewed(f, x) ? 'ok' : ''}">${isViewed(f, x) ? '✓' : ''}</span><span class="nm">${pathHtml(x.path)}${ch || n ? `<span class="rm">${ch ? `<span class="u">${ch.added != null ? plural(ch.added, 'new line') : 'reworked'}</span>` : ''}${n ? `<span>${plural(n, 'comment')}</span>` : ''}</span>` : ''}</span></button>`;
    }).join('')}</div>`).join('');
    rail.querySelectorAll('button').forEach(b => b.onclick = () => { focusAt = Number(b.dataset.i); renderFocus(); });
    rail.querySelector('button.on')?.scrollIntoView({ block: 'nearest' });

    const code = focus.querySelector('.code');
    // A new file starts at its top. A redraw of the same one (a comment, an unfolded block, Rendered or
    // Source) keeps the reader's place, now that the panel scrolls.
    const shown = `${f.id}\n${file.path}`, keep = focusShown === shown ? code.scrollTop : 0;
    const cs = entry(f.id).comments.filter(c => c.kind === 'file' && c.file === file.path);
    code.innerHTML = `${cs.map(c => `<div class="lc"><div class="who">file comment${delBtn(c)}</div>${esc(c.body)}</div>`).join('')}
      <div class="file" data-path="${esc(file.path)}"><div class="fbody">${fileBody(f, file)}</div></div>`;
    code.scrollTop = keep;
    focusShown = shown;
    markPhrases(code, f);
    focus.querySelector('.mdbox').innerHTML = mdToggle(file);
    code.querySelectorAll('.dl').forEach(row => row.onclick = () => { if (!submitted) openLineComposer(f, row, renderFocus); });
    bindRendered(focus, f, renderFocus);
    code.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const list = entry(f.id).comments; list.splice(list.findIndex(c => c.id === b.dataset.del), 1); save(); renderFocus();
    });
  }
  function markGood() {
    const f = focusFeature;
    const file = reading(f).flat[focusAt];
    if (!file || submitted) return;
    if (!isViewed(f, file)) toggleViewed(f, file);
    goFocus(1);
  }
  function fileComposer() {
    const f = focusFeature;
    const file = reading(f).flat[focusAt];
    if (!file || submitted) return;
    const c = makeComposer(file.path, (body) => {
      entry(f.id).comments.push({ id: uid(), kind: 'file', file: file.path, body, at: Date.now() });
      save(); renderFocus();
    }, 'float');
    Object.assign(c.style, { left: '50%', top: '84px', transform: 'translateX(-50%)' });
    focus.appendChild(c); c.querySelector('textarea').focus();
  }
  focus.querySelector('.close').onclick = closeFocus;
  focus.querySelector('.prev').onclick = () => goFocus(-1);
  focus.querySelector('.next').onclick = () => goFocus(1);
  focus.querySelector('.good').onclick = markGood;
  focus.querySelector('.say').onclick = fileComposer;
  // Swipe on a touchpad or a phone: horizontal only, so scrolling the code is untouched.
  let touch = null;
  focus.querySelector('.code').addEventListener('touchstart', (e) => { touch = e.changedTouches[0]; }, { passive: true });
  focus.querySelector('.code').addEventListener('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.clientX, dy = e.changedTouches[0].clientY - touch.clientY;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) goFocus(dx < 0 ? 1 : -1);
    touch = null;
  }, { passive: true });

  // ---- composers
  let composer = null;
  function closeComposer() { composer?.remove(); composer = null; document.getElementById('selbtn').hidden = true; }
  function makeComposer(quote, onSave, cls = '') {
    closeComposer();
    composer = document.createElement('div');
    composer.className = `composer ${cls}`;
    composer.innerHTML = `${quote ? `<div class="q">${esc(quote)}</div>` : ''}<textarea placeholder="Comment for the author"></textarea><div class="row"><button type="button" class="save">Save <kbd>${MOD}↵</kbd></button><button type="button" class="cancel">Cancel <kbd>Esc</kbd></button></div>`;
    const keep = () => { const body = composer.querySelector('textarea').value.trim(); if (body) onSave(body); closeComposer(); };
    composer.querySelector('.cancel').onclick = closeComposer;
    composer.querySelector('.save').onclick = keep;
    composer.querySelector('textarea').onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); keep(); } };
    return composer;
  }
  function openLineComposer(f, row, redraw = render) {
    const file = row.closest('.file').dataset.path, side = row.dataset.side, line = Number(row.dataset.line);
    const c = makeComposer(null, (body) => { entry(f.id).comments.push({ id: uid(), kind: 'line', file, side, line, body, at: Date.now() }); save(); redraw(); });
    row.insertAdjacentElement('afterend', c);
    c.querySelector('textarea').focus();
  }

  // Select text inside a commentable region and a Comment button appears above it.
  const selbtn = document.getElementById('selbtn');
  main.addEventListener('mouseup', () => setTimeout(() => {
    const sel = getSelection(); const quote = sel.toString().trim();
    if (!quote || sel.isCollapsed || submitted) { selbtn.hidden = true; return; }
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const region = node.closest('.commentable');
    if (!region) { selbtn.hidden = true; return; }
    const r = range.getBoundingClientRect();
    Object.assign(selbtn.style, { left: `${r.left + scrollX}px`, top: `${r.top + scrollY - 34}px` });
    selbtn.hidden = false;
    selbtn.onclick = () => {
      const unit = region.closest('[data-feature]')?.dataset.feature || shownId;
      const c = makeComposer(quote, (body) => { entry(unit).comments.push({ id: uid(), kind: 'text', section: region.dataset.section, quote, body, at: Date.now() }); save(); render(); }, 'float');
      Object.assign(c.style, { left: `${r.left + scrollX}px`, top: `${r.bottom + scrollY + 6}px` });
      document.body.appendChild(c); c.querySelector('textarea').focus();
    };
  }, 0));

  // Wrap the first occurrence of each quoted comment in a <mark>, when the quote sits inside one text node.
  function highlight(f, root = main) {
    for (const c of entry(f.id).comments.filter(c => c.kind === 'text')) {
      const region = root.querySelector(`.commentable[data-section="${c.section}"]`);
      if (!region) continue;
      const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.data.indexOf(c.quote);
        if (i < 0) continue;
        const mark = document.createElement('mark'); mark.className = 'hl'; mark.title = c.body;
        const after = n.splitText(i); after.splitText(c.quote.length);
        mark.textContent = after.data; after.replaceWith(mark);
        break;
      }
    }
  }

  // ---- output
  function summary() {
    const lines = [PLAN ? `## Plan review of ${data.pr.repo} — ${data.pr.title}` : `## Review of ${data.pr.repo}#${data.pr.number} at \`${data.pr.head}\``, ''];
    const short = (q) => q.length > 80 ? q.slice(0, 77) + '…' : q;
    const remarks = (s, name) => {
      for (const c of s.comments || []) {
        lines.push(c.kind === 'line' ? `   - \`${c.file}:${c.line}\` — ${c.body}`
          : c.kind === 'file' ? `   - \`${c.file}\` — ${c.body}`
          : c.kind === 'item' || name ? `   - ${name ? name(c.section) : c.section} "${short(c.quote)}" — ${c.body}`
          : `   - "${short(c.quote)}" — ${c.body}`);
      }
    };
    const unit = (label, s) => {
      const mark = s.decision === 'approved' ? '✅ Approved' : s.decision === 'changes' ? '❌ Changes requested' : '⬜ Not reviewed';
      lines.push(`${label} — ${mark}`);
      if (s.note) lines.push(`   > ${s.note.replace(/\n/g, '\n   > ')}`);
      remarks(s);
    };
    if (LAYERED) {
      for (const l of LEVELS) {
        const s = state[l.id] || {}, t = tallyOf(l.id);
        const mark = s.decision === 'approved' ? '✅ Approved'
          : s.decision === 'changes' ? `❌ Changes requested${t.open ? `, ${plural(t.open, 'clause')} not read` : ''}`
          : t.ok ? `⬜ Not finished, ${t.ok} of ${t.n} clauses signed` : '⬜ Not reviewed';
        lines.push(`- **${l.name} · ${l.title}** — ${mark}`);
        for (const id of order[l.id]) {
          const r = rowOf(id), c = clauses.get(id), text = clauseText(c);
          if (r?.d === 'change') lines.push(`   - ${clauseName(c)}${text ? ` "${short(text)}"` : ''} — ${r.note.replace(/\n/g, ' ')}`);
        }
        remarks(s, (section) => clauses.has(section) ? clauseName(clauses.get(section)) : section);
      }
      const touched = data.features.map((f, i) => [f, i]).filter(([f]) => state[f.id]?.decision || state[f.id]?.note || state[f.id]?.comments?.length);
      if (touched.length) lines.push('', `${codeName}:`);
      for (const [f, i] of touched) unit(`${i + 1}. **${f.title}**`, state[f.id]);
      return lines.join('\n');
    }
    data.features.forEach((f, i) => unit(`${i + 1}. **${f.title}**`, state[f.id] || {}));
    return lines.join('\n');
  }
  document.getElementById('copy').onclick = async (e) => { await navigator.clipboard.writeText(summary()); e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy review summary', 1500); };
  document.getElementById('export').onclick = () => {
    const blob = new Blob([JSON.stringify({ key, decisions: state }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `decisions-${data.pr.number}.json` }); a.click();
  };
  document.getElementById('submit').onclick = async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const r = await fetch('/api/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ features: state, summary: summary() }) });
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
    } catch {
      // The run may have timed out or been stopped. Nothing is lost: the state is on disk.
      btn.disabled = false; btn.textContent = 'Submit review (could not reach zreview — try again)';
      return;
    }
    submitted = true; btn.hidden = true; document.getElementById('submitted').hidden = false; render();
  };
  addEventListener('hashchange', () => {
    const next = location.hash.slice(1) || current;
    if (next === current && next === shownId) return;
    current = next; render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (composer) return closeComposer();
      if (composing && onLevel()) return cancelAsk();
      if (noting && zoom.hidden && !focusOpen()) { noting = null; return render(); }
      closeZoom(); return closeFocus();
    }
    if (onLevel() && levelKey(e)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const key = e.key;
    if (key === 'f' || key === 'F') { e.preventDefault(); return toggleFace(); }
    if (!focusOpen()) return;
    if (key === 'ArrowRight' || key === 'PageDown' || key === 'j') { e.preventDefault(); goFocus(1); }
    else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'k') { e.preventDefault(); goFocus(-1); }
    else if (key === 'Enter') { e.preventDefault(); markGood(); }
    else if (key === 'c' || key === 'C') { e.preventDefault(); fileComposer(); }
    else if (key === 'r' || key === 'R') {
      const file = reading(focusFeature).flat[focusAt];
      if (file && canRender(file)) { e.preventDefault(); setMdView(mdView === 'rendered' ? 'source' : 'rendered'); }
    }
  });
  if (LAYERED) syncLevels();
  render();
  drawAhead();
})();
