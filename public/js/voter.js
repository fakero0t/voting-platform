/* Voter: a list of all projects. Tap 1-10 to score each; scores can be
   changed any time until voting closes. */
(function () {
  const app = document.getElementById('app');
  const brandTag = document.getElementById('brandTag');
  const ACCENTS = ['--peri', '--coral', '--mint', '--grape', '--sun', '--pink'];

  const state = { projects: [], voterName: null, celebrated: false };

  // ---------- helpers ----------
  async function api(path, opts) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
    return data;
  }

  function toast(msg, isError) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' toast--error' : '');
    setTimeout(() => (t.className = 'toast'), 2200);
  }

  function haptic(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  const scoredCount = () => state.projects.filter((p) => p.myScore != null).length;

  // ---------- screens ----------
  function screenClosed(status) {
    document.documentElement.style.setProperty('--accent', 'var(--coral)');
    const msg = status === 'draft'
      ? { icon: '⏳', title: 'Almost there', body: "Voting hasn't opened yet. Check back with this link once it's live." }
      : { icon: '🎉', title: "That's a wrap", body: 'Voting is closed. Thanks for taking part!' };
    app.innerHTML = `
      <div class="screen card center stack">
        <div style="font-size:3rem">${msg.icon}</div>
        <h1 class="display">${msg.title}</h1>
        <p class="lead">${msg.body}</p>
      </div>`;
  }

  // Wait for Google Identity Services to finish loading (script is async in <head>).
  function waitForGoogle(timeout = 8000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const t = setInterval(() => {
        if (window.google && window.google.accounts && window.google.accounts.id) {
          clearInterval(t); resolve();
        } else if (Date.now() - started > timeout) {
          clearInterval(t); reject(new Error('Google sign-in failed to load.'));
        }
      }, 60);
    });
  }

  async function onCredential(response) {
    try {
      await api('/api/voter/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
      haptic(12);
      await loadList();
    } catch (e) { toast(e.message, true); }
  }

  async function screenName() {
    document.documentElement.style.setProperty('--accent', 'var(--peri)');
    app.innerHTML = `
      <div class="screen card stack">
        <div>
          <div class="eyebrow">Let's vote</div>
          <h1 class="display">Rate your favorite projects</h1>
          <p class="lead">Sign in with Google so your picks are counted — one vote per person, on any device. You can change any score until voting closes.</p>
        </div>
        <div id="gbtn" style="min-height:44px"></div>
        <p class="muted" id="gsHint" style="font-size:.9rem">Loading sign-in…</p>
      </div>`;
    const hint = document.getElementById('gsHint');

    let cfg;
    try { cfg = await api('/api/config'); } catch { cfg = {}; }
    if (!cfg.googleClientId) {
      hint.textContent = 'Sign-in isn’t configured yet — check back shortly.';
      return;
    }
    try {
      await waitForGoogle();
    } catch (e) { hint.textContent = e.message; return; }

    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onCredential });
    google.accounts.id.renderButton(document.getElementById('gbtn'), {
      theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', width: 260,
    });
    hint.hidden = true;
  }

  async function loadList() {
    const r = await api('/api/projects');
    state.voterName = r.voter.name;
    state.projects = r.projects;
    state.celebrated = scoredCount() === state.projects.length && state.projects.length > 0;
    brandTag.textContent = state.voterName;
    renderList();
  }

  function progressHtml() {
    const done = scoredCount();
    const total = state.projects.length;
    const pct = total ? (done / total) * 100 : 0;
    return `
      <div class="card stack" style="margin-bottom:18px">
        <div class="row row--between">
          <div>
            <div class="eyebrow">Hi ${esc(state.voterName)}</div>
            <h1 style="font-size:1.5rem;margin-top:4px">${done} of ${total} scored</h1>
          </div>
          <div class="chip chip--live"><span class="chip__led"></span>Voting open</div>
        </div>
        <div class="result__bar"><div class="result__fill" style="width:${pct}%;background:linear-gradient(90deg,var(--mint),var(--peri))"></div></div>
        <p class="muted" style="margin:0;font-size:.9rem">Tap a number to score a project. You can change any score until voting closes.</p>
      </div>`;
  }

  function cardHtml(p, i) {
    const accent = ACCENTS[i % ACCENTS.length];
    const pips = Array.from({ length: 10 }, (_, k) => k + 1)
      .map((n) => `<button class="pip" data-score="${n}" aria-pressed="${p.myScore === n}" aria-label="Score ${n}">${n}</button>`)
      .join('');
    const badge = p.myScore != null
      ? `<span class="chip chip--live" data-badge><span class="chip__led"></span>Your score: ${p.myScore}</span>`
      : `<span class="chip chip--draft" data-badge>Not scored yet</span>`;
    return `
      <div class="card stack vcard" data-pid="${p.id}" style="--accent:var(${accent})">
        ${badge}
        <div class="vcard__body">
          <div class="vcard__title">
            <div class="project__num">Project ${i + 1}</div>
            <h2 class="project__name" style="font-size:1.4rem">${esc(p.name)}</h2>
          </div>
          ${p.teamMembers ? `<p class="project__members" style="font-size:.85rem;opacity:.7;margin:.15rem 0 0">${esc(p.teamMembers)}</p>` : ''}
          ${p.description ? `<p class="project__desc">${esc(p.description)}</p>` : ''}
        </div>
        <div>
          <div class="scale">${pips}</div>
          <div class="scale__hint"><span>1 · Not for me</span><span>Amazing · 10</span></div>
        </div>
      </div>`;
  }

  function renderList() {
    app.innerHTML = `<div class="screen">${progressHtml()}<div class="stack">${
      state.projects.length
        ? state.projects.map(cardHtml).join('')
        : '<div class="card center"><p class="muted">No projects to vote on yet.</p></div>'
    }</div></div>`;

    app.querySelectorAll('.vcard').forEach((card) => {
      const pid = Number(card.dataset.pid);
      const project = state.projects.find((p) => p.id === pid);
      card.querySelectorAll('.pip').forEach((pip) => {
        pip.addEventListener('click', () => saveVote(project, Number(pip.dataset.score), card, pip));
      });
    });
  }

  async function saveVote(project, score, card, pip) {
    const prev = project.myScore;
    if (prev === score) return;
    // optimistic UI
    card.querySelectorAll('.pip').forEach((x) => { x.setAttribute('aria-pressed', 'false'); x.classList.remove('pop'); });
    pip.setAttribute('aria-pressed', 'true');
    pip.classList.add('pop');
    haptic(10);

    try {
      await api('/api/votes', { method: 'POST', body: JSON.stringify({ projectId: project.id, score }) });
      project.myScore = score;

      // update the badge
      const badge = card.querySelector('[data-badge]');
      badge.className = 'chip chip--live';
      badge.innerHTML = `<span class="chip__led"></span>Your score: ${score}`;

      // update progress bar + count
      const done = scoredCount();
      const total = state.projects.length;
      const bar = app.querySelector('.result__fill');
      if (bar) bar.style.width = (done / total) * 100 + '%';
      const heading = app.querySelector('.card h1');
      if (heading) heading.textContent = `${done} of ${total} scored`;

      toast(prev == null ? `Scored ${score}/10` : `Updated to ${score}/10`);

      if (done === total && !state.celebrated) {
        state.celebrated = true;
        const r = card.getBoundingClientRect();
        window.burstConfetti(r.left + r.width / 2, r.top);
        haptic([15, 50, 15, 50, 30]);
        setTimeout(() => toast('All projects scored 🎉 — tweak any until voting closes.'), 900);
      }
    } catch (e) {
      // revert
      pip.setAttribute('aria-pressed', 'false');
      if (prev != null) card.querySelector(`.pip[data-score="${prev}"]`)?.setAttribute('aria-pressed', 'true');
      if (/not open|closed/i.test(e.message)) { toast('Voting just closed.', true); setTimeout(init, 800); }
      else toast(e.message, true);
    }
  }

  // ---------- boot ----------
  async function init() {
    app.innerHTML = `<div class="card center"><p class="muted">Loading…</p></div>`;
    try {
      const s = await api('/api/state');
      if (s.status !== 'live') return screenClosed(s.status);
      if (s.voter) await loadList(); else screenName();
    } catch (e) {
      app.innerHTML = `<div class="card center stack"><h1 class="display">Hmm</h1><p class="lead">${esc(e.message)}</p></div>`;
    }
  }
  init();
})();
