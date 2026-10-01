// ─── main.js – Index page logic ─────────────────────────────
(() => {
const { parseFrontmatter, fmtDate, sevClass, statusClass, statusIcon, SEV_COLORS, ICONS } = window.BlogUtils;

let ALL_POSTS = [];
let filteredPosts = [];
let currentView = 'list';
let currentFilter = 'all';
let currentSearch = '';
let currentSort = 'date-desc';

// ─── Load manifest → fetch each postmortem ───────────────────
async function loadPosts() {
  showLoading();
  try {
    let posts = [];

    // 1. Try preloaded global manifest (from manifest.js)
    if (window.POSTMORTEM_MANIFEST && Array.isArray(window.POSTMORTEM_MANIFEST.posts) && window.POSTMORTEM_MANIFEST.posts.length > 0) {
      posts = window.POSTMORTEM_MANIFEST.posts;
    } else {
      // 2. Fetch manifest.json
      const resp = await fetch('postmortems/manifest.json');
      if (!resp.ok) throw new Error('manifest.json not found');
      const manifest = await resp.json();

      if (Array.isArray(manifest.posts) && manifest.posts.length > 0) {
        posts = manifest.posts;
      } else if (Array.isArray(manifest.files)) {
        // Fallback: fetch individual markdown files
        const fetched = await Promise.all(
          manifest.files.map(async (filename) => {
            try {
              const r = await fetch(`postmortems/${filename}`);
              if (!r.ok) return null;
              const raw = await r.text();
              const { meta } = parseFrontmatter(raw);
              return { filename, slug: filename.replace('.md', ''), ...meta };
            } catch {
              return null;
            }
          })
        );
        posts = fetched.filter(Boolean);
      }
    }

    if (!posts || posts.length === 0) {
      throw new Error('No postmortems found');
    }

    ALL_POSTS = posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    updateStats();
    applyFilters();
  } catch (e) {
    showError(e.message);
  }
}

// ─── Stats ───────────────────────────────────────────────────
function updateStats() {
  const total = ALL_POSTS.length;
  const p0 = ALL_POSTS.filter(p => p.severity === 'P0').length;
  const resolved = ALL_POSTS.filter(p => p.status === 'resolved').length;

  // Rough avg MTTR from duration strings
  const durations = ALL_POSTS.map(p => parseDuration(p.duration)).filter(Boolean);
  const avgMttr = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const mttrStr = avgMttr >= 60
    ? `${Math.floor(avgMttr / 60)}h ${avgMttr % 60}m`
    : `${avgMttr}m`;

  document.getElementById('stat-total').textContent = total;
  const bannerTotal = document.getElementById('stat-total-2');
  if (bannerTotal) bannerTotal.textContent = total;
  document.getElementById('stat-p0').textContent = p0;
  document.getElementById('stat-resolved').textContent = `${resolved}/${total}`;
  document.getElementById('stat-mttr').textContent = mttrStr || '—';

  // Update sidebar "All Incidents" badge
  const countAll = document.getElementById('count-all');
  if (countAll) countAll.textContent = total;

  // Sidebar counts
  const sevCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  ALL_POSTS.forEach(p => { if (sevCounts[p.severity] !== undefined) sevCounts[p.severity]++; });
  ['p0','p1','p2','p3'].forEach(s => {
    const el = document.getElementById(`count-${s}`);
    if (el) el.textContent = sevCounts[s.toUpperCase()];
  });

  // Uptime bar (last 30 days)
  buildUptimeBar();
}

function parseDuration(str) {
  if (!str) return 0;
  let mins = 0;
  const h = str.match(/(\d+)h/);
  const m = str.match(/(\d+)m/);
  if (h) mins += parseInt(h[1]) * 60;
  if (m) mins += parseInt(m[1]);
  return mins;
}

function buildUptimeBar() {
  const container = document.getElementById('uptime-bar');
  if (!container) return;

  const days = 30;
  const incidentDates = new Set(
    ALL_POSTS
      .filter(p => p.severity === 'P0' || p.severity === 'P1')
      .map(p => p.date)
  );

  let html = '';
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().split('T')[0];
    const cls = incidentDates.has(iso) ? 'incident' : 'ok';
    html += `<div class="uptime-day ${cls}" title="${iso}"></div>`;
  }
  container.innerHTML = html;
}

// ─── Filters / Search / Sort ─────────────────────────────────
function applyFilters() {
  let posts = [...ALL_POSTS];

  if (currentFilter !== 'all') {
    posts = posts.filter(p =>
      p.severity === currentFilter.toUpperCase() ||
      p.status === currentFilter
    );
  }

  if (currentSearch.trim()) {
    const q = currentSearch.toLowerCase();
    posts = posts.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.summary || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (p.services || []).some(s => s.toLowerCase().includes(q))
    );
  }

  switch (currentSort) {
    case 'date-asc': posts.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
    case 'date-desc': posts.sort((a, b) => new Date(b.date) - new Date(a.date)); break;
    case 'severity': posts.sort((a, b) => (a.severity || 'P9').localeCompare(b.severity || 'P9')); break;
    case 'duration': posts.sort((a, b) => parseDuration(b.duration) - parseDuration(a.duration)); break;
  }

  filteredPosts = posts;
  renderPosts();
}

// ─── Render cards ────────────────────────────────────────────
function renderPosts() {
  const container = document.getElementById('posts-container');
  const countEl = document.getElementById('results-count');

  if (countEl) countEl.textContent = `${filteredPosts.length} incident${filteredPosts.length !== 1 ? 's' : ''}`;

  if (!filteredPosts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:48px">📭</div>
        <div class="terminal-line">no postmortems found<span class="blink">_</span></div>
        <div style="font-size:12px;color:var(--text-muted)">Try adjusting your search or filters</div>
      </div>`;
    return;
  }

  container.className = `posts-grid${currentView === 'grid' ? ' grid-view' : ''}`;
  container.innerHTML = filteredPosts.map((p, i) => postCardHTML(p, i)).join('');
}

function postCardHTML(post, i) {
  const sev = post.severity || 'P3';
  const color = SEV_COLORS[sev] || '#58a6ff';
  const services = (post.services || []).slice(0, 4);
  const moreServices = (post.services || []).length - 4;

  return `
    <a href="post.html?slug=${encodeURIComponent(post.slug)}"
       class="post-card"
       style="--sev-color:${color}"
       id="post-${i}">
      <div class="post-header">
        <div class="post-title">${escapeHTML(post.title || post.slug)}</div>
        <div class="post-badges">
          <span class="badge ${sevClass(sev)}">${sev}</span>
          <span class="badge ${statusClass(post.status)}">${statusIcon(post.status)} ${post.status || 'resolved'}</span>
        </div>
      </div>
      ${post.summary ? `<div class="post-summary">${escapeHTML(post.summary)}</div>` : ''}
      <div class="post-meta">
        <span class="meta-item">${ICONS.calendar} ${fmtDate(post.date)}</span>
        ${post.duration ? `<span class="meta-item">${ICONS.clock} ${post.duration}</span>` : ''}
        ${post.author ? `<span class="meta-item">${ICONS.person} ${escapeHTML(post.author)}</span>` : ''}
      </div>
      ${services.length ? `
        <div class="post-services">
          ${services.map(s => `<span class="service-tag">${escapeHTML(s)}</span>`).join('')}
          ${moreServices > 0 ? `<span class="service-tag">+${moreServices}</span>` : ''}
        </div>` : ''}
    </a>`;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Loading / Error states ──────────────────────────────────
function showLoading() {
  document.getElementById('posts-container').innerHTML = `
    <div class="loading-state">
      <div class="loading-icon">⚙</div>
      <div class="terminal-line">loading postmortems<span class="blink">_</span></div>
    </div>`;
}

function showError(msg) {
  document.getElementById('posts-container').innerHTML = `
    <div class="empty-state">
      <div style="font-size:40px">⚠️</div>
      <div class="terminal-line" style="color:var(--sev-p0)">error: ${msg}</div>
      <div style="font-size:12px;color:var(--text-muted)">
        Make sure <code>postmortems/manifest.json</code> exists (generated by GitHub Actions)
      </div>
    </div>`;
}

// ─── Filter sidebar clicks ───────────────────────────────────
document.querySelectorAll('[data-filter]').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(x => x.classList.remove('active', 'selected'));
    el.classList.add('active', 'selected');
    currentFilter = el.dataset.filter;
    applyFilters();
  });
});

// ─── Search ──────────────────────────────────────────────────
document.getElementById('search-input')?.addEventListener('input', e => {
  currentSearch = e.target.value;
  applyFilters();
});

// ─── Sort ────────────────────────────────────────────────────
document.getElementById('sort-select')?.addEventListener('change', e => {
  currentSort = e.target.value;
  applyFilters();
});

// ─── View toggle ─────────────────────────────────────────────
document.getElementById('view-list')?.addEventListener('click', () => {
  currentView = 'list';
  document.getElementById('view-list').classList.add('active');
  document.getElementById('view-grid').classList.remove('active');
  applyFilters();
});

document.getElementById('view-grid')?.addEventListener('click', () => {
  currentView = 'grid';
  document.getElementById('view-grid').classList.add('active');
  document.getElementById('view-list').classList.remove('active');
  applyFilters();
});

// ─── Clock ───────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('utc-clock');
  if (!el) return;
  el.textContent = new Date().toUTCString().replace('GMT', 'UTC').slice(0, 25);
}
setInterval(updateClock, 1000);
updateClock();

// ─── Init ────────────────────────────────────────────────────
loadPosts();
})();
