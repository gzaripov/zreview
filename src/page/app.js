(() => {
  const data = JSON.parse(document.getElementById('review-data').textContent);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
  marked.setOptions({ mangle: false, headerIds: false });

  // ---- state: { [featureId]: { decision, note, at, comments: [{ id, kind, file, side, line, section, quote, body, at }] } }
  const key = `zreview:${data.pr.repo}#${data.pr.number}@${data.pr.head}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
  const save = () => localStorage.setItem(key, JSON.stringify(state));
  let state = load();
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
  if (data.unassigned?.length) {
    const u = document.getElementById('unassigned');
    u.hidden = false;
    u.innerHTML = `<details><summary>${data.unassigned.length} changed file${data.unassigned.length === 1 ? '' : 's'} not claimed by any feature</summary><ul>${data.unassigned.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>`;
  }

  // ---- sidebar
  function renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = data.features.map((f, i) => {
      const s = state[f.id] || {};
      const badge = s.decision === 'approved' ? 'approved' : s.decision === 'changes' ? 'changes' : 'open';
      const n = (s.comments || []).length;
      return `<button data-id="${esc(f.id)}" class="${f.id === current ? 'active' : ''}">
        <span class="n">${i + 1}</span><span class="t">${esc(f.title)}</span>${n ? `<span class="c">${n} ✎</span>` : ''}<span class="badge ${badge}">${badge}</span></button>`;
    }).join('');
    nav.querySelectorAll('button').forEach(b => b.onclick = () => { current = b.dataset.id; location.hash = current; render(); });
    const total = data.features.length, a = data.features.filter(f => state[f.id]?.decision === 'approved').length,
          c = data.features.filter(f => state[f.id]?.decision === 'changes').length;
    document.getElementById('tally').textContent = `${a} approved · ${c} changes requested · ${total - a - c} open`;
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
    const op = (o) => `<li class="op ${o.change || 'changed'}"><code>${esc(o.signature || o.name)}</code>${o.change ? `<span class="chip ${o.change}">${o.change}</span>` : ''}${o.note ? `<div class="opnote">${esc(o.note)}</div>` : ''}</li>`;
    return es.map(e => `<div class="entity ${e.change}">
      <div class="eh"><span class="chip ${e.change}">${e.change}</span><span class="ename">${esc(e.name)}</span>${e.kind ? `<span class="ekind">${esc(e.kind)}</span>` : ''}${e.from ? `<span class="efrom">was <code>${esc(e.from)}</code></span>` : ''}${e.file ? `<span class="efile">${esc(e.file)}</span>` : ''}</div>
      <div class="esum">${esc(e.summary)}</div>
      ${(e.operations || []).length ? `<ul class="ops">${e.operations.map(op).join('')}</ul>` : ''}
    </div>`).join('');
  }

  function fileBlock(f, file) {
    const open = expanded[f.id]?.has(file.path);
    const stat = file.hunks ? `<span class="stat"><span class="a">+${file.add}</span> <span class="d">−${file.del}</span></span>` : '';
    return `<div class="file" data-path="${esc(file.path)}">
      <div class="fh"><span class="tri">${open ? '▾' : '▸'}</span><span class="path">${esc(file.path)}</span>${file.status ? `<span class="st">${esc(file.status)}</span>` : ''}${stat}<a href="${esc(file.url)}" onclick="event.stopPropagation()">GitHub ↗</a></div>
      ${open ? hunks(f, file) : ''}
    </div>`;
  }

  function hunks(f, file) {
    if (!file.hunks) return `<p class="none" style="padding:8px 12px">Diff not loaded. Run with the PR's diff (gh on PATH, or --diff).</p>`;
    if (!file.hunks.length) return `<p class="none" style="padding:8px 12px">${file.status === 'binary' ? 'Binary file.' : 'No text changes.'}</p>`;
    const cs = entry(f.id).comments.filter(c => c.kind === 'line' && c.file === file.path);
    return file.hunks.map(h => `<div class="hunk"><div class="hh">${esc(h.header)}</div>${h.lines.map(l => {
      const side = l.t === '-' ? 'old' : 'new', line = l.t === '-' ? l.old : l.new;
      const mine = cs.filter(c => c.side === side && c.line === line);
      return `<div class="dl ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''} ${mine.length ? 'has' : ''}" data-side="${side}" data-line="${line}">
        <span class="g">${l.old ?? ''}</span><span class="g">${l.new ?? ''}</span><span class="code">${esc(l.t + l.text)}</span></div>` +
        mine.map(c => `<div class="lc"><div class="who">line comment<button data-del="${c.id}">delete</button></div>${esc(c.body)}</div>`).join('');
    }).join('')}</div>`).join('');
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
      ? f.diagrams.map((d, i) => `<figure><div class="diagram"><pre class="mermaid" id="mm-${i}">${esc(d.mermaid)}</pre></div><figcaption>${esc(d.title || '')}</figcaption></figure>`).join('')
      : `<p class="none">No flow or boundary change, so no diagram.</p>`;
    const files = (f.files || []).map(file => fileBlock(f, file)).join('');
    const dis = submitted ? 'disabled' : '';

    main.innerHTML = `
      <h2>${esc(f.title)}</h2>
      <div class="section"><h3>User scenario</h3><div class="scenario commentable" data-section="scenario">${esc(f.scenario || '')}</div></div>
      <div class="section"><h3>What changed</h3><div class="prose commentable" data-section="description">${md(f.description)}</div></div>
      <div class="section"><h3>Entities</h3>${entities(f)}</div>
      <div class="section"><h3>Architecture</h3>${diagrams}</div>
      <div class="section"><h3>Before / after</h3>${shots(f.screenshots)}</div>
      <div class="section"><h3>Diff</h3>${files || '<p class="none">No files listed.</p>'}</div>
      <div class="section"><h3>How it was tested</h3><div class="prose commentable" data-section="tested">${md(f.tested) || '<p class="none">Not stated.</p>'}</div></div>
      <div class="section"><h3>Comments</h3>${commentList(f)}</div>
      <div class="decide">
        <div class="row">
          <button class="approve ${st.decision === 'approved' ? 'on' : ''}" ${dis}>Approve</button>
          <button class="changes ${st.decision === 'changes' ? 'on' : ''}" ${dis}>Request changes</button>
          <span class="state">${st.decision ? `Decided ${new Date(st.at).toLocaleString()}` : 'No decision yet'}</span>
        </div>
        <textarea placeholder="Note for the author (optional)" ${dis}>${esc(st.note || '')}</textarea>
      </div>`;

    const decide = (decision) => { Object.assign(entry(f.id), { decision, note: main.querySelector('.decide textarea').value, at: Date.now() }); save(); render(); };
    main.querySelector('.approve').onclick = () => decide('approved');
    main.querySelector('.changes').onclick = () => decide('changes');
    main.querySelector('.decide textarea').onblur = (e) => { if (state[f.id]) { state[f.id].note = e.target.value; save(); } };

    main.querySelectorAll('.file > .fh').forEach(h => h.onclick = () => {
      const p = h.parentElement.dataset.path; const set = (expanded[f.id] ||= new Set());
      set.has(p) ? set.delete(p) : set.add(p); render();
    });
    main.querySelectorAll('.dl').forEach(row => row.onclick = () => { if (!submitted) openLineComposer(f, row); });
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = (e) => {
      e.stopPropagation(); const cs = entry(f.id).comments; cs.splice(cs.findIndex(c => c.id === b.dataset.del), 1); save(); render();
    });

    highlight(f);
    if ((f.diagrams || []).length) {
      try { await mermaid.run({ nodes: main.querySelectorAll('pre.mermaid') }); }
      catch (e) { main.querySelectorAll('pre.mermaid').forEach(p => p.insertAdjacentHTML('afterend', `<p class="none">Diagram failed to render: ${esc(e.message)}</p>`)); }
    }
  }

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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeComposer(); });
  render();
})();
