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
  document.getElementById('pr-meta').innerHTML =
    `<a href="${esc(data.pr.url)}">${esc(data.pr.repo)}#${data.pr.number}</a> · <code>${esc(data.pr.head)}</code> → ${esc(data.pr.base)}`;
  document.getElementById('pr-exposure').textContent = data.pr.exposure || '';
  if (SERVED) document.getElementById('submit').hidden = false;

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
    at: Date.now(), head: data.pr.head, text: textOf(f), entities: entityShots(f),
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
      const s = e.seen ||= { at: Date.now(), head: data.pr.head, files: {} };
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
  function wordDiff(before, after) {
    const tok = (s) => s.split(/(\s+)/).filter(x => x !== '');
    const a = tok(before), b = tok(after);
    if (a.length + b.length > 2400) return null;               // too long to diff cheaply; show the text plain
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    const push = (kind, text) => { const last = out[out.length - 1]; last && last.kind === kind ? last.text += text : out.push({ kind, text }); };
    while (i < m && j < n) {
      if (a[i] === b[j]) { push('same', b[j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i++]); }
      else { push('ins', b[j++]); }
    }
    while (i < m) push('del', a[i++]);
    while (j < n) push('ins', b[j++]);
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
      <div class="fh"><span class="tri">${open ? '▾' : '▸'}</span><span class="path">${esc(file.path)}</span>${file.status ? `<span class="st">${esc(file.status)}</span>` : ''}${upd ? `<span class="upd">${esc(chip)}</span>` : ''}${stat}<a href="${esc(file.url)}" onclick="event.stopPropagation()">GitHub ↗</a><label class="viewed" onclick="event.stopPropagation()"><input type="checkbox" ${seen ? 'checked' : ''} ${submitted ? 'disabled' : ''}>Viewed</label></div>
      ${open ? hunks(f, file) : ''}
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
      ...(upd.length ? [`${upd.length} file${upd.length === 1 ? '' : 's'}`] : []),
    ];
    const bar = ch.any ? `<div class="since">
      <span class="what"><b>Reworked since you looked${when ? ` on ${esc(when)}` : ''}:</b> ${esc(bits.join(', '))}</span>
      <label class="hl"><input type="checkbox" ${showDiff ? 'checked' : ''}>Show the old wording</label>
      <button class="seen" type="button" title="Take everything on this page as your new starting point">Mark as seen</button>
    </div>` : '';
    const prose = (k, html) => showDiff && k in ch.text ? diffHtml(ch.text[k], textOf(f)[k]) : html;
    const chip = (k) => k in ch.text || (k === 'diagrams' && ch.diagrams) ? `<span class="sub upd">updated</span>` : '';
    const decidedAt = !st.decision ? 'No decision yet'
      : `Decided ${new Date(st.at).toLocaleString()}${st.head && st.head !== data.pr.head ? ` at ${st.head.slice(0, 7)}` : ''}${upd.length ? `. <b>${upd.length} file${upd.length === 1 ? '' : 's'} changed since</b>, decide again.` : ''}`;

    main.innerHTML = `
      <h2>${esc(f.title)}</h2>
      ${bar}
      <div class="section"><h3>User scenario${chip('scenario')}</h3><div class="scenario commentable" data-section="scenario">${prose('scenario', esc(f.scenario || ''))}</div></div>
      <div class="section"><h3>What changed${chip('description')}</h3><div class="prose commentable" data-section="description">${prose('description', md(f.description))}</div></div>
      <div class="section"><h3>Entities</h3>${entities(f)}</div>
      <div class="section"><h3>Architecture${chip('diagrams')}</h3>${diagrams}</div>
      <div class="section"><h3>Before / after</h3>${shots(f.screenshots)}</div>
      <div class="section"><h3>Diff${v.total ? `<span class="sub ${v.seen === v.total ? 'all' : ''}">${v.seen} of ${v.total} viewed</span>` : ''}${v.total ? `<button class="focusbtn" type="button">Focus review ⛶</button>` : ''}</h3>${files || '<p class="none">No files listed.</p>'}</div>
      <div class="section"><h3>How it was tested${chip('tested')}</h3><div class="prose commentable" data-section="tested">${prose('tested', md(f.tested) || '<p class="none">Not stated.</p>')}</div></div>
      <div class="section"><h3>Comments</h3>${commentList(f)}</div>
      <div class="decide">
        <div class="row">
          <button class="approve ${st.decision === 'approved' ? 'on' : ''}" ${dis}>Approve</button>
          <button class="changes ${st.decision === 'changes' ? 'on' : ''}" ${dis}>Request changes</button>
          <span class="state">${decidedAt}</span>
        </div>
        <textarea placeholder="Note for the author (optional)" ${dis}>${esc(st.note || '')}</textarea>
      </div>`;

    const decide = (decision) => {
      Object.assign(entry(f.id), { decision, note: main.querySelector('.decide textarea').value, at: Date.now(), head: data.pr.head, seen: shot(f) });
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
    focusAt = -1; focus.hidden = true; focus.querySelector('.code').replaceChildren();
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
    const cs = entry(f.id).comments.filter(c => c.kind === 'file' && c.file === file.path);
    code.innerHTML = `${cs.map(c => `<div class="lc"><div class="who">file comment<button data-del="${c.id}">delete</button></div>${esc(c.body)}</div>`).join('')}
      <div class="file" data-path="${esc(file.path)}">${hunks(f, file)}</div>`;
    code.scrollTop = 0;
    code.querySelectorAll('.dl').forEach(row => row.onclick = () => { if (!submitted) openLineComposer(f, row, renderFocus); });
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
    const lines = [`## Review of ${data.pr.repo}#${data.pr.number} at \`${data.pr.head}\``, ''];
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
  });
  render();
})();
