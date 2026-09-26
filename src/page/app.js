(() => {
  const data = JSON.parse(document.getElementById('review-data').textContent);
  marked.setOptions({ mangle: false, headerIds: false });

  let monacoApi = null; const editors = [];   // Monaco, once its CDN load resolves; see below

  // ---- theme: data-theme on <html> is set before paint by a head script; here the toggle, and mermaid follows it
  const root = document.documentElement, themeBtn = document.getElementById('theme');
  const applyTheme = (t, persist) => {
    root.dataset.theme = t;
    if (persist) localStorage.setItem('zreview:theme', t);
    themeBtn.textContent = t === 'dark' ? '☀' : '☾';
    themeBtn.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    mermaid.initialize({ startOnLoad: false, theme: t === 'dark' ? 'dark' : 'default', securityLevel: 'strict' });
    if (monacoApi) monacoApi.editor.setTheme(t === 'dark' ? 'zreview-dark' : 'zreview-light');
  };
  applyTheme(root.dataset.theme, false);
  themeBtn.onclick = () => { applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true); render(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { if (!localStorage.getItem('zreview:theme')) { applyTheme(e.matches ? 'dark' : 'light', false); render(); } });

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
  let showDiff = true;                         // prose blocks show the old wording struck through while they are stale
  let current = location.hash.slice(1) || (data.features[0] && data.features[0].id);
  const expanded = {};                         // featureId -> Set of file paths open in the diff
  const entry = (id) => (state[id] ||= { comments: [] }, state[id].comments ||= [], state[id]);
  const uid = () => Math.random().toString(36).slice(2, 10);

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const md = (s) => s ? marked.parse(s) : '';
  const main = document.getElementById('main');

  document.getElementById('pr-title').textContent = data.pr.title;
  const PLAN = !!data.plan;
  document.getElementById('pr-meta').innerHTML = PLAN
    ? `<span class="planchip">Plan</span> ${esc(data.pr.repo)} · not built yet`
    : `<a href="${esc(data.pr.url)}">${esc(data.pr.repo)}#${data.pr.number}</a> · <code>${esc(data.pr.head)}</code> → ${esc(data.pr.base)}`;
  document.getElementById('pr-exposure').textContent = data.pr.exposure || '';
  if (SERVED) document.getElementById('submit').hidden = false;
  if (PLAN) document.getElementById('submit').textContent = 'Submit plan review';

  // ---- sidebar
  function renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = data.features.map((f, i) => {
      const s = state[f.id] || {};
      const upd = changedSince(f).length;
      const badge = upd ? 'updated' : s.decision === 'approved' ? 'approved' : s.decision === 'changes' ? 'changes' : 'open';
      const label = badge === 'changes' ? 'changes requested' : badge;
      const n = (s.comments || []).length, v = viewedCount(f);
      return `<button data-id="${esc(f.id)}" class="${f.id === current ? 'active' : ''}">
        <span class="n">${i + 1}</span><span class="body"><span class="t">${esc(f.title)}</span>
        <span class="meta">${n ? `<span class="c">${n} ✎</span>` : ''}${v.total ? `<span class="v ${v.seen === v.total ? 'all' : ''}" title="files viewed">${v.seen}/${v.total} 👁</span>` : ''}<span class="badge ${badge}" title="${upd ? `${upd} file${upd === 1 ? '' : 's'} changed since your decision` : ''}">${label}</span></span></span></button>`;
    }).join('');
    nav.querySelectorAll('button').forEach(b => b.onclick = () => { current = b.dataset.id; location.hash = current; render(); });
    const total = data.features.length, a = data.features.filter(f => state[f.id]?.decision === 'approved').length,
          c = data.features.filter(f => state[f.id]?.decision === 'changes').length;
    document.getElementById('tally').textContent = `${a} approved · ${c} changes requested · ${total - a - c} open`;
  }

  // ---- revisions: what the reviewer had in front of them last time. Taken when they decide on a
  // feature and, per file, when they mark it viewed. Everything a reviewer reads is in it — the prose,
  // the entities, the diagrams and the diff itself — so the next run can show what the author moved
  // rather than only that something moved.
  const LINE_CAP = 4000;                            // beyond this a file keeps its hash but not its lines
  const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  const fhash = (file) => file.hunks ? hashStr(JSON.stringify(file.hunks)) : null;
  const flatLines = (file) => file.hunks ? file.hunks.flatMap(h => h.lines.map(l => l.t + l.text)) : null;
  const fileShot = (file) => { const lines = flatLines(file); return { h: fhash(file), lines: lines && lines.length <= LINE_CAP ? lines : null }; };
  const textOf = (f) => ({ scenario: f.scenario || '', description: f.description || '', tested: f.tested || '' });
  const entityShots = (f) => Object.fromEntries((f.entities || []).map(e => [e.name, hashStr(JSON.stringify(e))]));
  const shot = (f) => ({
    at: Date.now(), head: data.pr.head || 'plan', text: textOf(f), entities: entityShots(f),
    diagrams: hashStr(JSON.stringify(f.diagrams || [])),
    files: Object.fromEntries((f.files || []).map(file => [file.path, fileShot(file)])),
  });
  const seenOf = (f) => entry(f.id).seen;
  const isViewed = (f, file) => { const v = entry(f.id).viewed ||= {}; return file.path in v && v[file.path] === fhash(file); };
  const viewedCount = (f) => { const files = f.files || []; return { seen: files.filter(x => isViewed(f, x)).length, total: files.length }; };
  function toggleViewed(f, file, on = !isViewed(f, file)) {
    const e = entry(f.id), v = e.viewed ||= {};
    if (on) {
      v[file.path] = fhash(file);
      // Viewing one file is a look at that file, so only its snapshot moves forward.
      const s = e.seen ||= { at: Date.now(), head: data.pr.head || 'plan', files: {} };
      (s.files ||= {})[file.path] = fileShot(file);
    } else delete v[file.path];
    if (on) expanded[f.id]?.delete(file.path);      // like GitHub: a viewed file folds
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
      const fresh = freshLines(flatLines(file), was.lines);
      out.files[file.path] = { fresh, added: fresh ? fresh.filter(Boolean).length : null, gone: fresh ? fresh.gone : null };
      out.any = true;
    }
    return out;
  }
  let sinceMemo = { id: null, val: null };
  const sinceOf = (f) => (sinceMemo.id === f.id ? sinceMemo.val : (sinceMemo = { id: f.id, val: since(f) }).val);
  const forgetSince = () => { sinceMemo = { id: null, val: null }; };
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
  const diffHtml = (before, after) => {
    const parts = wordDiff(before, after);
    if (!parts) return `<div class="wd plain">${esc(after)}</div>`;
    return `<div class="wd">${parts.map(p => p.kind === 'same' ? esc(p.text)
      : `<${p.kind === 'ins' ? 'ins' : 'del'}>${esc(p.text)}</${p.kind === 'ins' ? 'ins' : 'del'}>`).join('')}</div>`;
  };

  // ---- blocks
  function shots(s) {
    if (!s) return `<p class="none">No user-visible surface, so no screenshots.</p>`;
    const fig = (label, src) => src ? `<figure><div class="label">${label}</div><img src="${src}" alt="${label}"></figure>` : '';
    return `<div class="shots">${fig('Before', s.before_src)}${fig('After', s.after_src)}</div>` + (s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : '');
  }

  function entities(f) {
    const es = f.entities || [];
    if (!es.length) return `<p class="none">No domain entity added or changed.</p>`;
    const chip = (c, own) => c && c !== own ? `<span class="chip ${c}">${c}</span>` : '';
    const parts = (label, ps, own) => ps?.length ? `<div class="parts"><div class="plabel">${label}</div>
      ${ps.map(p => `<div class="part ${p.change || ''}"><div class="pname"><code>${esc(p.name)}</code>${p.type ? `<span class="ptype">${esc(p.type)}</span>` : ''}${chip(p.change, own)}</div>
        <div class="pmeaning">${esc(p.meaning)}${p.why ? `<div class="pwhy">${esc(p.why)}</div>` : ''}</div></div>`).join('')}</div>` : '';
    const examplesOf = (e) => e.examples?.length ? e.examples : e.example !== undefined ? [{ title: 'Example', value: e.example }] : [];
    const examples = (e, i) => {
      const exs = examplesOf(e);
      if (!exs.length) return '';
      return `<div class="examples" data-entity="${i}">
        <div class="tabs">${exs.map((x, j) => `<button type="button" class="${j ? '' : 'on'}" data-ex="${j}">${esc(x.title || `Example ${j + 1}`)}</button>`).join('')}</div>
        ${exs.map((x, j) => `<div class="ex" data-ex="${j}" ${j ? 'hidden' : ''}>${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}<div class="editor"><pre><code>${esc(exampleText(x))}</code></pre></div></div>`).join('')}
      </div>`;
    };
    const moved = sinceOf(f).entities;
    return es.map((e, i) => `<div class="entity ${e.change} ${examplesOf(e).length ? 'with-examples' : ''} ${moved.has(e.name) ? 'moved' : ''}">
      <div class="eh"><span class="chip ${e.change}">${e.change}</span><span class="ename">${esc(e.name)}</span>${moved.has(e.name) ? `<span class="upd">reworked since you looked</span>` : ''}${e.kind ? `<span class="ekind">${esc(e.kind)}</span>` : ''}${e.from ? `<span class="efrom">was <code>${esc(e.from)}</code></span>` : ''}${e.file ? `<span class="efile">${esc(e.file)}</span>` : ''}</div>
      <div class="ebody"><div class="etext">
        <div class="esum">${esc(e.summary)}${e.why ? `<div class="ewhy">${esc(e.why)}</div>` : ''}</div>
        ${parts('Consists of', e.fields, e.change)}${parts('What you can do', e.operations, e.change)}
      </div>${examples(e, i)}</div>
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
  function mountEditors(f) {
    editors.splice(0).forEach(ed => ed.dispose());
    if (!monacoApi) return;
    (f.entities || []).forEach((e, i) => {
      const exs = e.examples?.length ? e.examples : e.example !== undefined ? [{ title: 'Example', value: e.example }] : [];
      exs.forEach((x, j) => {
        const host = main.querySelector(`.examples[data-entity="${i}"] .ex[data-ex="${j}"] .editor`);
        if (!host) return;
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
        editors.push(ed);
      });
    });
  }

  function fileBlock(f, file) {
    const open = expanded[f.id]?.has(file.path), seen = isViewed(f, file), ch = sinceOf(f).files[file.path];
    const upd = !!ch, chip = ch?.added != null ? `${ch.added} new line${ch.added === 1 ? '' : 's'}${ch.gone ? `, ${ch.gone} gone` : ''}` : 'updated since your last look';
    const stat = file.hunks ? `<span class="stat"><span class="a">+${file.add}</span> <span class="d">−${file.del}</span></span>` : '';
    return `<div class="file ${seen ? 'seen' : ''}" data-path="${esc(file.path)}">
      <div class="fh"><span class="tri">${open ? '▾' : '▸'}</span><span class="path">${esc(file.path)}</span>${file.status ? `<span class="st">${esc(file.status)}</span>` : ''}${upd ? `<span class="upd">${esc(chip)}</span>` : ''}${mdToggle(file)}${stat}<a href="${esc(file.url)}" onclick="event.stopPropagation()">GitHub ↗</a><label class="viewed" onclick="event.stopPropagation()"><input type="checkbox" ${seen ? 'checked' : ''} ${submitted ? 'disabled' : ''}>Viewed</label></div>
      ${open ? fileBody(f, file) : ''}
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
  function hlLines(text, lang) {
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
    const fresh = sinceOf(f).files[file.path]?.fresh;        // lines the reviewer has not seen
    let fi = 0;
    return file.hunks.map(h => {
      const oh = hlLines(h.lines.filter(l => l.t !== '+').map(l => l.text).join('\n'), lang);
      const nh = hlLines(h.lines.filter(l => l.t !== '-').map(l => l.text).join('\n'), lang);
      let oi = 0, ni = 0;
      return `<div class="hunk"><div class="hh">${esc(h.header)}</div>${h.lines.map(l => {
        const side = l.t === '-' ? 'old' : 'new', line = l.t === '-' ? l.old : l.new;
        const code = l.t === '-' ? oh[oi++] : l.t === '+' ? nh[ni++] : (oi++, nh[ni++]);
        const mine = cs.filter(c => c.side === side && c.line === line);
        const isNew = fresh?.[fi++];
        return `<div class="dl ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''} ${mine.length ? 'has' : ''} ${isNew ? 'fresh' : ''}" data-side="${side}" data-line="${line}" ${isNew ? 'title="New since your last look"' : ''}>
          <span class="g">${l.old ?? ''}</span><span class="g">${l.new ?? ''}</span><span class="code"><span class="sign">${l.t}</span>${code}</span></div>` +
          mine.map(c => `<div class="lc"><div class="who">line comment<button data-del="${c.id}">delete</button></div>${esc(c.body)}</div>`).join('');
      }).join('')}</div>`;
    }).join('');
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
  function likeness(o, n) {
    if (o.type !== n.type || o.token?.depth !== n.token?.depth || (o.type === 'item' && o.list.ordered !== n.list.ordered)) return 0;
    if (o.type === 'table' && (o.token.header.length !== n.token.header.length || o.token.rows.length !== n.token.rows.length)) return 0;
    if (byLine(o)) {
      const a = linesOf(o), b = linesOf(n);
      if (a.join('\n') === b.join('\n') || a.length * b.length > 1e6) return 0;
      return lcsOps(a, b).filter(op => op[0] === 'same').length / Math.max(a.length, b.length);
    }
    const a = unitText(o), b = unitText(n), parts = a !== b && wordDiff(a, b);
    if (!parts) return 0;
    const solid = (s) => s.replace(/\s+/g, '').length;
    return parts.reduce((k, p) => k + (p.kind === 'same' ? solid(p.text) : 0), 0) / Math.max(solid(a), solid(b), 1);
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
    return `<pre class="rd-lines"><code>${lcsOps(a, b).map(([kind, i, j]) => `<span class="ln ${kind}">${kind === 'del' ? ha[i] : hb[j]}</span>`).join('')}</code></pre>`;
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

  const canRender = (file) => MARKDOWN.test(file.path) && !!file.text && !!window.DOMPurify && !!richModel(file);
  const fileBody = (f, file) => mdView === 'rendered' && canRender(file) ? richDiff(f, file) : hunks(f, file);
  function mdToggle(file) {
    if (!MARKDOWN.test(file.path) || !file.hunks?.length) return '';
    const can = canRender(file), on = mdView === 'rendered' && can;
    const why = can ? '' : !window.DOMPurify ? 'The sanitizer did not load, so Markdown shows as source'
      : 'No rendered view: it needs the whole file, which zreview fetches with gh at the head commit';
    return `<span class="mdview"${why ? ` title="${esc(why)}"` : ''}><button type="button" data-mdview="rendered" class="${on ? 'on' : ''}" ${can ? '' : 'disabled'}>Rendered</button><button type="button" data-mdview="source" class="${on ? '' : 'on'}">Source</button></span>`;
  }
  function setMdView(v) { mdView = v; localStorage.setItem('zreview:mdview', v); render(); renderFocus(); }
  function bindRendered(root, f, redraw) {
    root.querySelectorAll('[data-mdview]').forEach(b => b.onclick = (e) => { e.stopPropagation(); if (!b.disabled) setMdView(b.dataset.mdview); });
    root.querySelectorAll('.rd-u > .rc').forEach(b => b.onclick = () => { if (!submitted) openLineComposer(f, b.parentElement, redraw); });
    root.querySelectorAll('.rd-more').forEach(b => b.onclick = () => { richOpen.add(b.dataset.more); redraw(); });
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
    const fresh = sinceOf(f).files[file.path]?.fresh, unseen = { old: new Set(), new: new Set() };
    if (fresh) { let fi = 0; for (const h of file.hunks) for (const l of h.lines) if (fresh[fi++]) l.t === '-' ? unseen.old.add(l.old) : unseen.new.add(l.new); }
    const isFresh = (e) => ['old', 'new'].some(side => {
      const u = unitOn(e, side);
      for (let n = u?.from; u && n <= u.to; n++) if (unseen[side].has(n)) return true;
      return false;
    });
    const changed = rows.map((e, i) => e.kind !== 'same' || own.has(i));
    const near = rows.map((_, i) => changed.slice(Math.max(0, i - 2), i + 3).some(Boolean));
    const folded = new Map();
    for (let i = 0; i < rows.length;) {
      if (near[i]) { i++; continue; }
      let j = i; while (j < rows.length && !near[j]) j++;
      if (j - i >= 3 && !richOpen.has(`${file.path}#${i}`)) folded.set(i, j);
      i = j;
    }
    const row = (i, tag) => {
      const e = rows[i], side = e.kind === 'del' ? 'old' : 'new', u = unitOn(e, side), nw = isFresh(e);
      const notes = (own.get(i) || []).map(c => `<div class="lc"><div class="who">line comment<button data-del="${c.id}">delete</button></div>${esc(c.body)}</div>`).join('');
      return `<${tag} class="rd-u ${e.kind} t-${u.type}${nw ? ' fresh' : ''}" data-side="${side}" data-line="${u.from}"${nw ? ' title="New since your last look"' : ''}>`
        + `${submitted ? '' : '<button type="button" class="rc" title="Comment on this">+</button>'}${entryHtml(e)}${tag === 'li' ? notes : ''}</${tag}>${tag === 'li' ? '' : notes}`;
    };
    const out = [];
    for (let i = 0; i < rows.length;) {
      if (folded.has(i)) {
        const n = folded.get(i) - i;
        out.push(`<button type="button" class="rd-more" data-more="${esc(`${file.path}#${i}`)}">⋯ ${n} unchanged block${n === 1 ? '' : 's'}</button>`);
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

  function commentList(f) {
    const cs = entry(f.id).comments;
    if (!cs.length) return `<p class="none">No comments on this feature.</p>`;
    return cs.map(c => `<div class="cm">
      <div class="who"><span class="where">${c.kind === 'line' ? `${esc(c.file)}:${c.line} (${c.side})` : c.kind === 'file' ? esc(c.file) : esc(c.section)}</span><button data-del="${c.id}">delete</button></div>
      ${c.quote ? `<div class="quote">${esc(c.quote)}</div>` : ''}${esc(c.body)}</div>`).join('');
  }

  // ---- feature panel
  async function render() {
    renderNav();
    closeComposer();
    const f = data.features.find(x => x.id === current) || data.features[0];
    if (!f) { main.innerHTML = '<p class="none">No features in review.json.</p>'; return; }
    const st = state[f.id] || {};
    const diagrams = (f.diagrams || []).length
      ? f.diagrams.map((d, i) => `<figure><div class="diagram"><button class="fs" type="button" title="Full screen" aria-label="Full screen">⛶</button><pre class="mermaid" id="mm-${i}">${esc(d.mermaid)}</pre></div><figcaption>${esc(d.title || '')}</figcaption></figure>`).join('')
      : `<p class="none">No flow or boundary change, so no diagram.</p>`;
    const files = (f.files || []).map(file => fileBlock(f, file)).join('');
    const dis = submitted ? 'disabled' : '';
    const v = viewedCount(f);
    const ch = sinceOf(f), upd = changedSince(f);
    const when = ch.at ? new Date(ch.at).toLocaleString() : '';
    const bits = [
      ...['scenario', 'description', 'tested'].filter(k => k in ch.text).map(k => ({ scenario: 'the scenario', description: 'what changed', tested: 'how it was tested' })[k]),
      ...(ch.diagrams ? ['the diagrams'] : []),
      ...(ch.entities.size ? [`${ch.entities.size} entit${ch.entities.size === 1 ? 'y' : 'ies'}`] : []),
      ...(upd.length ? [`${upd.length} reworked file${upd.length === 1 ? '' : 's'}`] : []),
      ...(ch.newFiles?.length ? [`${ch.newFiles.length} file${ch.newFiles.length === 1 ? '' : 's'} not there before`] : []),
    ];
    const bar = ch.any ? `<div class="since">
      <span class="what"><b>Reworked since you looked${when ? ` on ${esc(when)}` : ''}:</b> ${esc(bits.join(', '))}</span>
      <label class="hl"><input type="checkbox" ${showDiff ? 'checked' : ''}>Show the old wording</label>
      <button class="seen" type="button" title="Take everything on this page as your new starting point">Mark as seen</button>
    </div>` : '';
    const prose = (k, html) => showDiff && k in ch.text ? diffHtml(ch.text[k], textOf(f)[k]) : html;
    const chip = (k) => k in ch.text || (k === 'diagrams' && ch.diagrams) ? `<span class="sub upd">updated</span>` : '';
    const decidedAt = !st.decision ? 'No decision yet'
      : `Decided ${new Date(st.at).toLocaleString()}${st.head === 'plan' && !PLAN ? ' on the plan' : st.head && st.head !== data.pr.head ? ` at ${st.head.slice(0, 7)}` : ''}${upd.length ? `. <b>${upd.length} file${upd.length === 1 ? '' : 's'} changed since</b>, decide again.` : ''}`;

    main.innerHTML = `
      <h2>${esc(f.title)}</h2>
      ${bar}
      <div class="section"><h3>User scenario${chip('scenario')}</h3><div class="scenario commentable" data-section="scenario">${prose('scenario', esc(f.scenario || ''))}</div></div>
      <div class="section"><h3>What changed${chip('description')}</h3><div class="prose commentable" data-section="description">${prose('description', md(f.description))}</div></div>
      <div class="section"><h3>Entities</h3>${entities(f)}</div>
      <div class="section"><h3>Architecture${chip('diagrams')}</h3>${diagrams}</div>
      <div class="section"><h3>Before / after</h3>${shots(f.screenshots)}</div>
      <div class="section"><h3>${PLAN ? 'Files' : 'Diff'}${v.total ? `<span class="sub ${v.seen === v.total ? 'all' : ''}">${v.seen} of ${v.total} viewed</span>` : ''}${v.total ? `<button class="focusbtn" type="button">Focus review ⛶</button>` : ''}</h3>${files || `<p class="none">${PLAN ? 'Not written yet. The plan above is what you are approving.' : 'No files listed.'}</p>`}</div>
      <div class="section"><h3>How it ${PLAN ? 'will be' : 'was'} tested${chip('tested')}</h3><div class="prose commentable" data-section="tested">${prose('tested', md(f.tested) || '<p class="none">Not stated.</p>')}</div></div>
      <div class="section"><h3>Comments</h3>${commentList(f)}</div>
      <div class="decide">
        <div class="row">
          <button class="approve ${st.decision === 'approved' ? 'on' : ''}" ${dis}>${PLAN ? 'Approve plan' : 'Approve'}</button>
          <button class="changes ${st.decision === 'changes' ? 'on' : ''}" ${dis}>Request changes</button>
          <span class="state">${decidedAt}</span>
        </div>
        <textarea placeholder="${PLAN ? 'What the plan should do differently (optional)' : 'Note for the author (optional)'}" ${dis}>${esc(st.note || '')}</textarea>
      </div>`;

    const decide = (decision) => {
      Object.assign(entry(f.id), { decision, note: main.querySelector('.decide textarea').value, at: Date.now(), head: data.pr.head || 'plan', seen: shot(f) });
      save(); render();
    };
    main.querySelector('.approve').onclick = () => decide('approved');
    main.querySelector('.changes').onclick = () => decide('changes');
    main.querySelector('.decide textarea').onblur = (e) => { if (state[f.id]) { state[f.id].note = e.target.value; save(); } };

    main.querySelectorAll('.file > .fh').forEach(h => h.onclick = () => {
      const p = h.parentElement.dataset.path; const set = (expanded[f.id] ||= new Set());
      set.has(p) ? set.delete(p) : set.add(p); render();
    });
    const hl = main.querySelector('.since .hl input');
    if (hl) hl.onchange = () => { showDiff = hl.checked; render(); };
    const seenBtn = main.querySelector('.since .seen');
    if (seenBtn) seenBtn.onclick = () => { entry(f.id).seen = shot(f); save(); render(); };
    main.querySelector('.focusbtn') && (main.querySelector('.focusbtn').onclick = () => openFocus(f));
    main.querySelectorAll('.file .viewed input').forEach(cb => cb.onchange = () => toggleViewed(f, f.files.find(x => x.path === cb.closest('.file').dataset.path), cb.checked));
    main.querySelectorAll('.dl').forEach(row => row.onclick = () => { if (!submitted) openLineComposer(f, row); });
    bindRendered(main, f, render);
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = (e) => {
      e.stopPropagation(); const cs = entry(f.id).comments; cs.splice(cs.findIndex(c => c.id === b.dataset.del), 1); save(); render();
    });

    main.querySelectorAll('.examples .tabs button').forEach(b => b.onclick = () => {
      const box = b.closest('.examples');
      box.querySelectorAll('.tabs button').forEach(t => t.classList.toggle('on', t === b));
      box.querySelectorAll('.ex').forEach(x => x.hidden = x.dataset.ex !== b.dataset.ex);
      editors.forEach(ed => ed.layout());
    });
    highlight(f);
    monacoReady.then(() => { if (data.features.find(x => x.id === current) === f) mountEditors(f); });
    if ((f.diagrams || []).length) {
      try { await mermaid.run({ nodes: main.querySelectorAll('pre.mermaid') }); }
      catch (e) { main.querySelectorAll('pre.mermaid').forEach(p => p.insertAdjacentHTML('afterend', `<p class="none">Diagram failed to render: ${esc(e.message)}</p>`)); }
    }
      main.querySelectorAll('.diagram .fs').forEach(b => b.onclick = () => openZoom(b.parentElement));
  }

  // ---- full-screen diagram
  const zoom = document.getElementById('zoom');
  function openZoom(box) {
    const svg = box.querySelector('svg');
    if (!svg) return;
    zoom.querySelector('.body').replaceChildren(svg.cloneNode(true));
    zoom.querySelector('.cap').textContent = box.parentElement.querySelector('figcaption')?.textContent || '';
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

  // ---- reading order: what a reviewer should meet first. The domain types a feature declares come
  // first (they name everything downstream), then what stores them, then the logic, the edges it is
  // reached through, the surface, and last the tests and generated files that only confirm the rest.
  const ORDER = [
    ['domain', 'Domain types'], ['data', 'Persistence'], ['logic', 'Logic'],
    ['edge', 'Interfaces'], ['ui', 'Surface'], ['test', 'Tests'], ['config', 'Config and generated'],
  ];
  const entityFiles = (f) => new Set((f.entities || []).map(e => e.file).filter(Boolean));
  function groupOf(f, path) {
    if (/(^|[\/._-])(tests?|specs?|__tests__|__mocks__|fixtures?|snapshots?)([\/._-]|$)/i.test(path)) return 'test';
    if (/(^|\/)(package-lock|bun\.lock|yarn\.lock|pnpm-lock|go\.sum|cargo\.lock)|\.(lock|ya?ml|toml|ini|cfg|env)$|(^|\/)(dockerfile|makefile)/i.test(path)) return 'config';
    if (entityFiles(f).has(path)) return 'domain';
    if (/(^|[\/._-])(entit|model|schema|domain|dto|types?)([\/._-]|$)/i.test(path)) return 'domain';
    if (/(^|[\/._-])(repositor|store|dao|database|db|migrations?|quer|sql|prisma|persist)/i.test(path)) return 'data';
    if (/(^|[\/._-])(route|router|api|endpoint|controller|cli|command|serve|server|middleware)/i.test(path)) return 'edge';
    if (/\.(css|scss|sass|less|html|svg|vue|svelte)$|(^|[\/._-])(component|view|page|screen|style|ui)/i.test(path)) return 'ui';
    return 'logic';
  }
  /** The feature's files, grouped and flattened into the order the rail and the arrows follow. */
  function reading(f) {
    const files = f.files || [];
    const groups = ORDER.map(([key, label]) => ({ key, label, files: files.filter(x => groupOf(f, x.path) === key) })).filter(g => g.files.length);
    return { groups, flat: groups.flatMap(g => g.files) };
  }

  // ---- focus review: one file at a time, full screen, in that order
  const focus = document.getElementById('focus');
  let focusAt = -1;                                 // index into reading(current).flat, -1 when closed
  let focusShown = null;                            // the file the panel last drew, so a redraw of it keeps its scroll
  const focusOpen = () => focusAt >= 0;
  function openFocus(f, index) {
    const { flat } = reading(f);
    if (!flat.length) return;
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
    const f = data.features.find(x => x.id === current);
    const { flat } = reading(f);
    const next = focusAt + step;
    if (next < 0 || next >= flat.length) return closeFocus();   // off either end: back to the feature
    focusAt = next; renderFocus();
  }
  function renderFocus() {
    if (!focusOpen()) return;
    const f = data.features.find(x => x.id === current);
    const { groups, flat } = reading(f);
    const file = flat[focusAt];
    if (!file) return closeFocus();
    const seen = flat.filter(x => isViewed(f, x)).length;
    focus.querySelector('.rtitle').textContent = f.title;
    focus.querySelector('.rcount').textContent = `${seen}/${flat.length} viewed`;
    focus.querySelector('.progress span').style.width = `${Math.round((seen / flat.length) * 100)}%`;
    focus.querySelector('.pos').textContent = `${focusAt + 1} of ${flat.length}`;
    focus.querySelector('.path').textContent = file.path;
    const fch = sinceOf(f).files[file.path];
    focus.querySelector('.newly').textContent = fch ? (fch.added != null ? `${fch.added} new line${fch.added === 1 ? '' : 's'} since you looked` : 'reworked since you looked') : '';
    focus.querySelector('.newly').hidden = !fch;
    focus.querySelector('.good').textContent = isViewed(f, file) ? 'Viewed ✓' : 'Looks good ✓';
    focus.querySelector('.good').classList.toggle('on', isViewed(f, file));

    const rail = focus.querySelector('.rlist');
    rail.innerHTML = groups.map(g => `<div class="rgroup"><div class="glabel">${esc(g.label)}</div>${g.files.map(x => {
      const i = flat.indexOf(x), dir = x.path.slice(0, x.path.lastIndexOf('/') + 1), name = x.path.slice(dir.length);
      const n = entry(f.id).comments.filter(c => (c.kind === 'line' || c.kind === 'file') && c.file === x.path).length;
      const ch = sinceOf(f).files[x.path];
      return `<button data-i="${i}" class="${i === focusAt ? 'on' : ''} ${isViewed(f, x) ? 'seen' : ''}">
        <span class="tick">${isViewed(f, x) ? '✓' : ''}</span><span class="nm"><span class="dir">${esc(dir)}</span>${esc(name)}</span>${ch ? `<span class="u" title="${ch.added != null ? `${ch.added} new lines` : 'reworked'}">●</span>` : ''}${n ? `<span class="c">${n} ✎</span>` : ''}</button>`;
    }).join('')}</div>`).join('');
    rail.querySelectorAll('button').forEach(b => b.onclick = () => { focusAt = Number(b.dataset.i); renderFocus(); });
    rail.querySelector('button.on')?.scrollIntoView({ block: 'nearest' });

    const code = focus.querySelector('.code');
    // A new file starts at its top. A redraw of the same one (a comment, an unfolded block, Rendered or
    // Source) keeps the reader's place, now that the panel scrolls.
    const shown = `${f.id}\n${file.path}`, keep = focusShown === shown ? code.scrollTop : 0;
    const cs = entry(f.id).comments.filter(c => c.kind === 'file' && c.file === file.path);
    code.innerHTML = `${cs.map(c => `<div class="lc"><div class="who">file comment<button data-del="${c.id}">delete</button></div>${esc(c.body)}</div>`).join('')}
      <div class="file" data-path="${esc(file.path)}">${fileBody(f, file)}</div>`;
    code.scrollTop = keep;
    focusShown = shown;
    focus.querySelector('.mdbox').innerHTML = mdToggle(file);
    code.querySelectorAll('.dl').forEach(row => row.onclick = () => { if (!submitted) openLineComposer(f, row, renderFocus); });
    bindRendered(focus, f, renderFocus);
    code.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const list = entry(f.id).comments; list.splice(list.findIndex(c => c.id === b.dataset.del), 1); save(); renderFocus();
    });
  }
  function markGood() {
    const f = data.features.find(x => x.id === current);
    const file = reading(f).flat[focusAt];
    if (!file || submitted) return;
    if (!isViewed(f, file)) toggleViewed(f, file);
    goFocus(1);
  }
  function fileComposer() {
    const f = data.features.find(x => x.id === current);
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
    composer.innerHTML = `${quote ? `<div class="q">${esc(quote)}</div>` : ''}<textarea placeholder="Comment"></textarea><div class="row"><button class="save">Save</button><button class="cancel">Cancel</button></div>`;
    composer.querySelector('.cancel').onclick = closeComposer;
    composer.querySelector('.save').onclick = () => { const body = composer.querySelector('textarea').value.trim(); if (body) onSave(body); closeComposer(); };
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
      const f = data.features.find(x => x.id === current);
      const c = makeComposer(quote, (body) => { entry(f.id).comments.push({ id: uid(), kind: 'text', section: region.dataset.section, quote, body, at: Date.now() }); save(); render(); }, 'float');
      Object.assign(c.style, { left: `${r.left + scrollX}px`, top: `${r.bottom + scrollY + 6}px` });
      document.body.appendChild(c); c.querySelector('textarea').focus();
    };
  }, 0));

  // Wrap the first occurrence of each quoted comment in a <mark>, when the quote sits inside one text node.
  function highlight(f) {
    for (const c of entry(f.id).comments.filter(c => c.kind === 'text')) {
      const region = main.querySelector(`.commentable[data-section="${c.section}"]`);
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
    data.features.forEach((f, i) => {
      const s = state[f.id] || {};
      const mark = s.decision === 'approved' ? '✅ Approved' : s.decision === 'changes' ? '❌ Changes requested' : '⬜ Not reviewed';
      lines.push(`${i + 1}. **${f.title}** — ${mark}`);
      if (s.note) lines.push(`   > ${s.note.replace(/\n/g, '\n   > ')}`);
      for (const c of s.comments || []) {
        lines.push(c.kind === 'line' ? `   - \`${c.file}:${c.line}\` — ${c.body}`
          : c.kind === 'file' ? `   - \`${c.file}\` — ${c.body}`
          : `   - "${c.quote.length > 80 ? c.quote.slice(0, 77) + '…' : c.quote}" — ${c.body}`);
      }
    });
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
  addEventListener('hashchange', () => { current = location.hash.slice(1) || current; render(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (composer) return closeComposer(); closeZoom(); return closeFocus(); }
    if (!focusOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const key = e.key;
    if (key === 'ArrowRight' || key === 'PageDown' || key === 'j') { e.preventDefault(); goFocus(1); }
    else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'k') { e.preventDefault(); goFocus(-1); }
    else if (key === 'Enter') { e.preventDefault(); markGood(); }
    else if (key === 'c' || key === 'C') { e.preventDefault(); fileComposer(); }
    else if (key === 'r' || key === 'R') {
      const file = reading(data.features.find(x => x.id === current)).flat[focusAt];
      if (file && canRender(file)) { e.preventDefault(); setMdView(mdView === 'rendered' ? 'source' : 'rendered'); }
    }
  });
  render();
})();
