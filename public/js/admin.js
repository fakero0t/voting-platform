/* Admin: log in, manage projects, set status, watch live results. */
(function () {
  const app = document.getElementById('app');
  let tab = 'setup';
  let pollTimer = null;
  const openVoters = new Set(); // which result cards have their voter list expanded

  async function api(path, opts) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/login')) { renderLogin(); throw new Error('Session expired.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' toast--error' : '');
    setTimeout(() => (t.className = 'toast'), 2400);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ---------------- login ----------------
  function renderLogin() {
    stopPolling();
    app.innerHTML = `
      <div class="screen card stack" style="max-width:420px;margin:0 auto">
        <div>
          <div class="eyebrow">Admin</div>
          <h1 class="display">Sign in</h1>
          <p class="lead">Enter the admin password to manage the vote.</p>
        </div>
        <input class="field" id="pw" type="password" placeholder="Admin password" autocomplete="current-password">
        <button class="btn btn--block" id="login">Sign in</button>
      </div>`;
    const pw = document.getElementById('pw');
    const btn = document.getElementById('login');
    pw.focus();
    const go = async () => {
      btn.disabled = true;
      try {
        await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pw.value }) });
        renderDashboard();
      } catch (e) { toast(e.message, true); btn.disabled = false; pw.select(); }
    };
    btn.addEventListener('click', go);
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  // ---------------- dashboard shell ----------------
  async function renderDashboard() {
    stopPolling();
    app.innerHTML = `
      <div class="row row--between" style="margin-bottom:22px;flex-wrap:wrap;gap:14px">
        <div class="tabs">
          <button class="tab ${tab === 'setup' ? 'active' : ''}" data-tab="setup">Setup</button>
          <button class="tab ${tab === 'results' ? 'active' : ''}" data-tab="results">Results</button>
        </div>
        <button class="btn btn--ghost btn--sm" id="logout">Sign out</button>
      </div>
      <div id="panel"></div>`;

    app.querySelectorAll('.tab').forEach((b) =>
      b.addEventListener('click', () => { tab = b.dataset.tab; renderDashboard(); }));
    app.querySelector('#logout').addEventListener('click', async () => {
      await api('/api/admin/logout', { method: 'POST' }); renderLogin();
    });

    if (tab === 'setup') renderSetup();
    else renderResults();
  }

  // ---------------- setup tab ----------------
  async function renderSetup() {
    const data = await api('/api/admin/results'); // includes status + projects (with counts)
    const panel = document.getElementById('panel');
    const status = data.status;
    const editable = status === 'draft';
    const voterUrl = location.origin + '/';

    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const statusChip = `<span class="chip chip--${status}"><span class="chip__led"></span>${cap(status)}</span>`;
    const actionBtn =
      status === 'draft'
        ? `<button class="btn" id="statusBtn" data-status="live">Set voting live →</button>`
        : status === 'live'
        ? `<button class="btn" id="statusBtn" data-status="closed" style="background:linear-gradient(135deg,var(--coral),var(--pink))">Close voting</button>`
        : `<button class="btn" id="statusBtn" data-status="live">Reopen voting</button>`;

    const projectRows = data.projects.length
      ? data.projects.map((p) => `
        <div class="a-project" data-id="${p.id}">
          <div class="a-project__head">
            <div>
              <div class="a-project__name">${esc(p.name)}</div>
              ${p.team_members ? `<div class="a-project__desc" style="opacity:.7">${esc(p.team_members)}</div>` : ''}
              ${p.description ? `<div class="a-project__desc">${esc(p.description)}</div>` : ''}
            </div>
            ${editable ? `<div class="row" style="gap:8px">
              <button class="btn btn--ghost btn--sm" data-edit="${p.id}">Edit</button>
              <button class="btn btn--ghost btn--sm" data-del="${p.id}">Delete</button>
            </div>` : `<span class="muted" style="font-size:.85rem">${p.voteCount} vote${p.voteCount === 1 ? '' : 's'}</span>`}
          </div>
        </div>`).join('')
      : `<p class="muted">No projects yet. Add the first one below.</p>`;

    panel.innerHTML = `
      <div class="screen admin-grid">
        <div class="card stack">
          <div class="row row--between" style="flex-wrap:wrap;gap:12px">
            <div>
              <div class="eyebrow">Voting status</div>
              <div class="row" style="gap:10px;align-items:center;margin-top:6px">
                <h2 style="font-size:1.4rem">Status:</h2>${statusChip}
              </div>
            </div>
            <div class="row" style="gap:12px;align-items:center">${actionBtn}</div>
          </div>
          <p class="muted" style="margin:0">
            ${status === 'draft' ? 'Add your projects, then set the vote <b>Live</b> and share the link.'
              : status === 'live' ? 'Voting is <b>live</b>. Projects are locked so it stays fair. Watch results roll in on the Results tab.'
              : 'Voting is <b>closed</b>. Final results are on the Results tab.'}
          </p>
          <div>
            <label class="lbl">Voter link ${status === 'live' ? '' : '(active once you go live)'}</label>
            <div class="link-box">
              <input class="field" id="voterLink" readonly value="${voterUrl}">
              <button class="btn btn--sm" id="copyLink">Copy</button>
            </div>
          </div>
        </div>

        <div class="card stack">
          <div class="row row--between">
            <h2 style="font-size:1.4rem">Projects</h2>
            <span class="muted" style="font-size:.85rem">${data.projects.length} total</span>
          </div>
          <div id="projectList">${projectRows}</div>
          ${editable ? `
            <div class="stack" style="border-top:1px solid var(--line);padding-top:18px">
              <div>
                <label class="lbl" for="pName">Project name</label>
                <input class="field" id="pName" placeholder="e.g. Realtime Dashboard" maxlength="120">
              </div>
              <div>
                <label class="lbl" for="pDesc">Description <span class="muted">(optional)</span></label>
                <textarea class="field" id="pDesc" placeholder="A sentence or two so voters know what they're rating."></textarea>
              </div>
              <button class="btn" id="addProject">Add project</button>
            </div>
            <div class="stack" style="border-top:1px solid var(--line);padding-top:18px">
              <div>
                <label class="lbl">Replace all projects from a CSV</label>
                <p class="muted" style="font-size:.85rem;margin:.2rem 0 0">Same columns as the Demo Day form (Team Name, Team Members, Elevator Pitch). This replaces every project and clears existing votes.</p>
              </div>
              <input class="field" type="file" id="csvFile" accept=".csv,text/csv">
              <button class="btn btn--ghost" id="uploadCsv">Upload &amp; replace</button>
            </div>` : `<p class="muted" style="font-size:.9rem">Projects can only be changed while the vote is a draft.</p>`}
        </div>
      </div>`;

    // status action button
    const statusBtn = panel.querySelector('#statusBtn');
    statusBtn.addEventListener('click', async () => {
      const next = statusBtn.dataset.status;
      if (next === 'closed' && !confirm('Close voting? Voters will no longer be able to submit.')) return;
      try {
        await api('/api/admin/status', { method: 'POST', body: JSON.stringify({ status: next }) });
        toast(`Vote is now ${next}.`);
        renderSetup();
      } catch (e) { toast(e.message, true); }
    });

    // copy link
    panel.querySelector('#copyLink').addEventListener('click', async () => {
      const input = panel.querySelector('#voterLink');
      try { await navigator.clipboard.writeText(input.value); }
      catch { input.select(); document.execCommand('copy'); }
      toast('Link copied — send it to your voters.');
    });

    if (editable) {
      panel.querySelector('#addProject').addEventListener('click', async () => {
        const name = panel.querySelector('#pName').value.trim();
        const description = panel.querySelector('#pDesc').value.trim();
        if (!name) { toast('Give the project a name.', true); return; }
        try {
          await api('/api/admin/projects', { method: 'POST', body: JSON.stringify({ name, description }) });
          toast('Project added.');
          renderSetup();
        } catch (e) { toast(e.message, true); }
      });

      panel.querySelectorAll('[data-del]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('Delete this project?')) return;
          try { await api('/api/admin/projects/' + b.dataset.del, { method: 'DELETE' }); toast('Project deleted.'); renderSetup(); }
          catch (e) { toast(e.message, true); }
        }));

      panel.querySelectorAll('[data-edit]').forEach((b) =>
        b.addEventListener('click', () => editProject(b.dataset.edit, data.projects)));

      const uploadBtn = panel.querySelector('#uploadCsv');
      uploadBtn.addEventListener('click', async () => {
        const file = panel.querySelector('#csvFile').files[0];
        if (!file) { toast('Choose a CSV file first.', true); return; }
        if (!confirm('Replace ALL projects with this CSV? Existing projects and any votes will be cleared.')) return;
        uploadBtn.disabled = true;
        try {
          const csv = await file.text();
          const r = await api('/api/admin/projects/upload', { method: 'POST', body: JSON.stringify({ csv }) });
          toast(`Imported ${r.count} team${r.count === 1 ? '' : 's'}.`);
          renderSetup();
        } catch (e) { toast(e.message, true); uploadBtn.disabled = false; }
      });
    }
  }

  function editProject(id, projects) {
    const p = projects.find((x) => String(x.id) === String(id));
    const row = document.querySelector(`.a-project[data-id="${id}"]`);
    row.innerHTML = `
      <div class="stack">
        <input class="field" id="eName" value="${esc(p.name)}" maxlength="120">
        <textarea class="field" id="eDesc" placeholder="Description">${esc(p.description || '')}</textarea>
        <div class="row" style="gap:8px">
          <button class="btn btn--sm" id="save">Save</button>
          <button class="btn btn--ghost btn--sm" id="cancel">Cancel</button>
        </div>
      </div>`;
    row.querySelector('#cancel').addEventListener('click', renderSetup);
    row.querySelector('#save').addEventListener('click', async () => {
      const name = row.querySelector('#eName').value.trim();
      const description = row.querySelector('#eDesc').value.trim();
      if (!name) { toast('Name is required.', true); return; }
      try { await api('/api/admin/projects/' + id, { method: 'PUT', body: JSON.stringify({ name, description }) }); toast('Saved.'); renderSetup(); }
      catch (e) { toast(e.message, true); }
    });
  }

  // ---------------- results tab ----------------
  async function renderResults() {
    await paintResults(true); // animate the first render only
    stopPolling();
    pollTimer = setInterval(() => { if (tab === 'results') paintResults(); }, 3000);
  }

  async function paintResults(animate = false) {
    let data;
    try { data = await api('/api/admin/results'); } catch { return; }
    const panel = document.getElementById('panel');
    if (!panel) return;

    const statusChip = `<span class="chip chip--${data.status}"><span class="chip__led"></span>${data.status[0].toUpperCase() + data.status.slice(1)}</span>`;
    const totalVotes = data.projects.reduce((s, p) => s + p.voteCount, 0);

    const cards = data.projects.length ? data.projects.map((p) => {
      const votes = data.votesByProject[p.id] || [];
      const avg = p.average != null ? p.average : null;
      const pct = avg != null ? (avg / 10) * 100 : 0;
      const open = openVoters.has(p.id);
      const voterRows = votes.length
        ? votes.slice().sort((a, b) => b.score - a.score)
            .map((v) => `<li><span>${esc(v.voterName)}</span><span class="score">${v.score}</span></li>`).join('')
        : `<li><span class="muted">No votes yet</span><span></span></li>`;
      return `
        <div class="result">
          <div class="result__top">
            <div>
              <div class="a-project__name">${esc(p.name)}</div>
              ${p.teamMembers ? `<div class="a-project__desc" style="opacity:.7">${esc(p.teamMembers)}</div>` : ''}
              ${p.description ? `<div class="a-project__desc">${esc(p.description)}</div>` : ''}
            </div>
            <div style="text-align:right">
              <div class="result__avg">${avg != null ? avg.toFixed(1) : '–'}<small>/10</small></div>
            </div>
          </div>
          <div class="result__bar"><div class="result__fill" style="width:${pct}%"></div></div>
          <div class="row row--between">
            <span class="result__count">${p.voteCount} vote${p.voteCount === 1 ? '' : 's'}</span>
            <button class="voters-toggle" data-toggle="${p.id}">${open ? 'Hide' : 'See'} who voted</button>
          </div>
          <ul class="vote-list ${open ? '' : 'hidden'}">${voterRows}</ul>
        </div>`;
    }).join('') : `<div class="card center"><p class="muted">No projects to show yet.</p></div>`;

    panel.innerHTML = `
      <div class="${animate ? 'screen' : ''}">
        <div class="card stack" style="margin-bottom:20px">
          <div class="row row--between" style="flex-wrap:wrap;gap:12px">
            <div>
              <div class="eyebrow">Live results</div>
              <h2 style="font-size:1.4rem;margin-top:4px">${data.voters.length} voter${data.voters.length === 1 ? '' : 's'} · ${totalVotes} vote${totalVotes === 1 ? '' : 's'}</h2>
            </div>
            ${statusChip}
          </div>
          <p class="muted" style="margin:0;font-size:.9rem">Updates automatically as votes come in.</p>
        </div>
        ${cards}
      </div>`;

    panel.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.toggle);
        openVoters.has(id) ? openVoters.delete(id) : openVoters.add(id);
        paintResults();
      }));
  }

  // ---------------- boot ----------------
  (async function init() {
    try { await api('/api/admin/me'); renderDashboard(); }
    catch { renderLogin(); }
  })();
})();
