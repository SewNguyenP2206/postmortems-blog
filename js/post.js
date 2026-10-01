// ─── post.js – Individual post page ─────────────────────────
const { parseFrontmatter, fmtDate, sevClass, statusClass, statusIcon, SEV_COLORS, ICONS, marked } = window.BlogUtils;

const params = new URLSearchParams(location.search);
const slug = params.get('slug');

async function loadPost() {
  if (!slug) { showError('No post slug provided'); return; }

  try {
    let postMeta = null;
    let postContent = '';

    // 1. Check window.POSTMORTEM_MANIFEST
    if (window.POSTMORTEM_MANIFEST && Array.isArray(window.POSTMORTEM_MANIFEST.posts)) {
      const found = window.POSTMORTEM_MANIFEST.posts.find(
        p => p.slug === slug || p.filename === slug || p.filename === `${slug}.md`
      );
      if (found && found.content) {
        postMeta = found;
        postContent = found.content;
      }
    }

    // 2. Fetch raw .md file
    if (!postContent) {
      try {
        const resp = await fetch(`postmortems/${slug}.md`);
        if (resp.ok) {
          const raw = await resp.text();
          const { meta, content } = parseFrontmatter(raw);
          postMeta = meta;
          postContent = content;
        }
      } catch (err) {
        console.warn('Direct .md fetch failed, trying manifest.json', err);
      }
    }

    // 3. Fallback: fetch manifest.json
    if (!postContent) {
      try {
        const mResp = await fetch('postmortems/manifest.json');
        if (mResp.ok) {
          const mData = await mResp.json();
          const found = (mData.posts || []).find(
            p => p.slug === slug || p.filename === slug || p.filename === `${slug}.md`
          );
          if (found && found.content) {
            postMeta = found;
            postContent = found.content;
          }
        }
      } catch (err) {
        console.warn('manifest.json fetch failed', err);
      }
    }

    if (!postContent) {
      throw new Error(`Post not found: ${slug}.md`);
    }

    renderPost(postMeta || {}, postContent);
  } catch (e) {
    showError(e.message);
  }
}

function renderPost(meta, content) {
  const sev = meta.severity || 'P3';
  const color = SEV_COLORS[sev] || '#58a6ff';

  // Page title
  document.title = `${meta.title || slug} | DevOps Postmortems`;

  // Header
  document.getElementById('post-title').textContent = meta.title || slug;

  // Badges
  const badgesEl = document.getElementById('post-badges');
  badgesEl.innerHTML = `
    <span class="badge ${sevClass(sev)}" style="font-size:13px;padding:4px 12px">${sev}</span>
    <span class="badge ${statusClass(meta.status)}" style="font-size:13px;padding:4px 12px">
      ${statusIcon(meta.status)} ${meta.status || 'resolved'}
    </span>`;

  // Meta row
  document.getElementById('post-meta-row').innerHTML = `
    <span class="meta-item" style="font-size:13px">${ICONS.calendar} ${fmtDate(meta.date)}</span>
    ${meta.duration ? `<span class="meta-item" style="font-size:13px">${ICONS.clock} ${meta.duration}</span>` : ''}
    ${meta.author ? `<span class="meta-item" style="font-size:13px">${ICONS.person} ${escapeHTML(meta.author)}</span>` : ''}`;

  // Severity bar accent
  document.getElementById('sev-accent-bar').style.background = color;

  // Info panel
  document.getElementById('info-severity').innerHTML =
    `<span class="badge ${sevClass(sev)}">${sev}</span>`;
  document.getElementById('info-status').innerHTML =
    `<span class="badge ${statusClass(meta.status)}">${statusIcon(meta.status)} ${meta.status || 'resolved'}</span>`;
  document.getElementById('info-date').textContent = fmtDate(meta.date);
  document.getElementById('info-duration').textContent = meta.duration || '—';
  document.getElementById('info-author').textContent = meta.author || '—';

  // Services
  const servicesEl = document.getElementById('info-services');
  if (meta.services && meta.services.length) {
    servicesEl.innerHTML = meta.services.map(s =>
      `<span class="service-tag">${escapeHTML(s)}</span>`
    ).join('');
  } else {
    servicesEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px">—</span>';
  }

  // Tags
  const tagsEl = document.getElementById('info-tags');
  if (meta.tags && meta.tags.length) {
    tagsEl.innerHTML = meta.tags.map(t =>
      `<span class="tag-pill">#${escapeHTML(t)}</span>`
    ).join('');
  } else {
    tagsEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px">—</span>';
  }

  // Markdown content
  const bodyEl = document.getElementById('post-body');
  bodyEl.innerHTML = marked.parse(content);

  // Table of contents
  buildTOC(bodyEl);

  // Scroll spy
  initScrollSpy();
}

function buildTOC(bodyEl) {
  const headings = bodyEl.querySelectorAll('h2, h3');
  if (!headings.length) return;

  const toc = document.getElementById('toc-list');
  toc.innerHTML = Array.from(headings).map(h => {
    const level = h.tagName === 'H2' ? 'h2' : 'h3';
    const id = h.id || h.textContent.toLowerCase().replace(/[^\w]+/g, '-');
    if (!h.id) h.id = id;
    return `<li class="toc-item ${level}">
      <a href="#${id}">${escapeHTML(h.textContent)}</a>
    </li>`;
  }).join('');
}

function initScrollSpy() {
  const headings = document.querySelectorAll('.markdown-body h2, .markdown-body h3');
  const tocLinks = document.querySelectorAll('.toc-item a');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        tocLinks.forEach(l => l.classList.remove('active'));
        const link = document.querySelector(`.toc-item a[href="#${entry.target.id}"]`);
        if (link) link.classList.add('active');
      }
    });
  }, { rootMargin: '-80px 0px -60% 0px' });

  headings.forEach(h => observer.observe(h));
}

function showError(msg) {
  document.getElementById('post-body').innerHTML = `
    <div class="empty-state">
      <div style="font-size:40px">⚠️</div>
      <div class="terminal-line" style="color:var(--sev-p0)">error: ${msg}</div>
      <a href="index.html" class="post-back-btn" style="margin-top:16px">← Back to all postmortems</a>
    </div>`;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init ────────────────────────────────────────────────────
loadPost();
