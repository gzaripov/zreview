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
    localStorage.setItem(key, JSON.stringify(state));
    if (SERVED) fetch('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state), keepalive: true }).catch(() => {});
  };
  let state = SERVED ? (INITIAL_STATE || {}) : load();
  let submitted = false;
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

  // ---- file fingerprints: a file is "the same" while its hunks are. A viewed mark and a decision both
  // remember the fingerprints they were made against, so a reworked file comes back unviewed and a
  // feature whose files were reworked after a decision shows as updated.
  const fhash = (file) => {
    if (!file.hunks) return null;
    const s = JSON.stringify(file.hunks); let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  };
  const fingerprints = (f) => Object.fromEntries((f.files || []).map(file => [file.path, fhash(file)]));
  const isViewed = (f, file) => { const v = entry(f.id).viewed ||= {}; return file.path in v && v[file.path] === fhash(file); };
  const viewedCount = (f) => { const files = f.files || []; return { seen: files.filter(x => isViewed(f, x)).length, total: files.length }; };
  function toggleViewed(f, file, on) {
    const v = entry(f.id).viewed ||= {};
    on ? v[file.path] = fhash(file) : delete v[file.path];
    if (on) expanded[f.id]?.delete(file.path);      // like GitHub: a viewed file folds
    save(); render();
  }
  /** Paths whose hunks differ from what the current decision was made against. */
  function changedSince(f) {
    const st = state[f.id]; if (!st?.decision || !st.files) return [];
    const now = fingerprints(f), then = st.files;
    return [...new Set([...Object.keys(now), ...Object.keys(then)])].filter(p => now[p] !== then[p] && (now[p] ?? then[p]) !== null).sort();
  }

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
    return es.map((e, i) => `<div class="entity ${e.change} ${examplesOf(e).length ? 'with-examples' : ''}">
      <div class="eh"><span class="chip ${e.change}">${e.change}</span><span class="ename">${esc(e.name)}</span>${e.kind ? `<span class="ekind">${esc(e.kind)}</span>` : ''}${e.from ? `<span class="efrom">was <code>${esc(e.from)}</code></span>` : ''}${e.file ? `<span class="efile">${esc(e.file)}</span>` : ''}</div>
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
    const open = expanded[f.id]?.has(file.path), seen = isViewed(f, file), upd = changedSince(f).includes(file.path);
    const stat = file.hunks ? `<span class="stat"><span class="a">+${file.add}</span> <span class="d">−${file.del}</span></span>` : '';
    return `<div class="file ${seen ? 'seen' : ''}" data-path="${esc(file.path)}">
      <div class="fh"><span class="tri">${open ? '▾' : '▸'}</span><span class="path">${esc(file.path)}</span>${file.status ? `<span class="st">${esc(file.status)}</span>` : ''}${upd ? `<span class="upd">updated since your decision</span>` : ''}${stat}<a href="${esc(file.url)}" onclick="event.stopPropagation()">GitHub ↗</a><label class="viewed" onclick="event.stopPropagation()"><input type="checkbox" ${seen ? 'checked' : ''} ${submitted ? 'disabled' : ''}>Viewed</label></div>
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
    return file.hunks.map(h => {
      const oh = hlLines(h.lines.filter(l => l.t !== '+').map(l => l.text).join('\n'), lang);
      const nh = hlLines(h.lines.filter(l => l.t !== '-').map(l => l.text).join('\n'), lang);
      let oi = 0, ni = 0;
      return `<div class="hunk"><div class="hh">${esc(h.header)}</div>${h.lines.map(l => {
        const side = l.t === '-' ? 'old' : 'new', line = l.t === '-' ? l.old : l.new;
        const code = l.t === '-' ? oh[oi++] : l.t === '+' ? nh[ni++] : (oi++, nh[ni++]);
        const mine = cs.filter(c => c.side === side && c.line === line);
        return `<div class="dl ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''} ${mine.length ? 'has' : ''}" data-side="${side}" data-line="${line}">
          <span class="g">${l.old ?? ''}</span><span class="g">${l.new ?? ''}</span><span class="code"><span class="sign">${l.t}</span>${code}</span></div>` +
          mine.map(c => `<div class="lc"><div class="who">line comment<button data-del="${c.id}">delete</button></div>${esc(c.body)}</div>`).join('');
      }).join('')}</div>`;
    }).join('');
  }

  function commentList(f) {
    const cs = entry(f.id).comments;
    if (!cs.length) return `<p class="none">No comments on this feature.</p>`;
    return cs.map(c => `<div class="cm">
      <div class="who"><span class="where">${c.kind === 'line' ? `${esc(c.file)}:${c.line} (${c.side})` : esc(c.section)}</span><button data-del="${c.id}">delete</button></div>
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
    const upd = changedSince(f);
    const decidedAt = !st.decision ? 'No decision yet'
      : `Decided ${new Date(st.at).toLocaleString()}${st.head && st.head !== data.pr.head ? ` at ${st.head.slice(0, 7)}` : ''}${upd.length ? `. <b>${upd.length} file${upd.length === 1 ? '' : 's'} changed since</b>, decide again.` : ''}`;

    main.innerHTML = `
      <h2>${esc(f.title)}</h2>
      <div class="section"><h3>User scenario</h3><div class="scenario commentable" data-section="scenario">${esc(f.scenario || '')}</div></div>
      <div class="section"><h3>What changed</h3><div class="prose commentable" data-section="description">${md(f.description)}</div></div>
      <div class="section"><h3>Entities</h3>${entities(f)}</div>
      <div class="section"><h3>Architecture</h3>${diagrams}</div>
      <div class="section"><h3>Before / after</h3>${shots(f.screenshots)}</div>
      <div class="section"><h3>Diff${v.total ? `<span class="sub ${v.seen === v.total ? 'all' : ''}">${v.seen} of ${v.total} viewed</span>` : ''}</h3>${files || '<p class="none">No files listed.</p>'}</div>
      <div class="section"><h3>How it was tested</h3><div class="prose commentable" data-section="tested">${md(f.tested) || '<p class="none">Not stated.</p>'}</div></div>
      <div class="section"><h3>Comments</h3>${commentList(f)}</div>
      <div class="decide">
        <div class="row">
          <button class="approve ${st.decision === 'approved' ? 'on' : ''}" ${dis}>Approve</button>
          <button class="changes ${st.decision === 'changes' ? 'on' : ''}" ${dis}>Request changes</button>
          <span class="state">${decidedAt}</span>
        </div>
        <textarea placeholder="Note for the author (optional)" ${dis}>${esc(st.note || '')}</textarea>
      </div>`;

    const decide = (decision) => { Object.assign(entry(f.id), { decision, note: main.querySelector('.decide textarea').value, at: Date.now(), head: data.pr.head, files: fingerprints(f) }); save(); render(); };
    main.querySelector('.approve').onclick = () => decide('approved');
    main.querySelector('.changes').onclick = () => decide('changes');
    main.querySelector('.decide textarea').onblur = (e) => { if (state[f.id]) { state[f.id].note = e.target.value; save(); } };

    main.querySelectorAll('.file > .fh').forEach(h => h.onclick = () => {
      const p = h.parentElement.dataset.path; const set = (expanded[f.id] ||= new Set());
      set.has(p) ? set.delete(p) : set.add(p); render();
    });
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
  function openLineComposer(f, row) {
    const file = row.closest('.file').dataset.path, side = row.dataset.side, line = Number(row.dataset.line);
    const c = makeComposer(null, (body) => { entry(f.id).comments.push({ id: uid(), kind: 'line', file, side, line, body, at: Date.now() }); save(); render(); });
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
        lines.push(c.kind === 'line' ? `   - \`${c.file}:${c.line}\` — ${c.body}` : `   - "${c.quote.length > 80 ? c.quote.slice(0, 77) + '…' : c.quote}" — ${c.body}`);
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
    e.target.disabled = true;
    const r = await fetch('/api/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ features: state, summary: summary() }) });
    if (!r.ok) { e.target.disabled = false; return; }
    submitted = true; e.target.hidden = true; document.getElementById('submitted').hidden = false; render();
  };
  addEventListener('pagehide', () => { if (SERVED && !submitted) navigator.sendBeacon('/api/dismiss'); });
  addEventListener('hashchange', () => { current = location.hash.slice(1) || current; render(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeZoom(); closeComposer(); } });
  render();
})();
