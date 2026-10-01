// ─── post.js – Individual post page ─────────────────────────
(() => {
const { parseFrontmatter, fmtDate, sevClass, statusClass, statusIcon, SEV_COLORS, ICONS, marked } = window.BlogUtils;

const params = new URLSearchParams(location.search);
const slug = params.get('slug');
const PAGE_COPY = {
  en: {
    breadcrumb: 'postmortems',
    back: 'Back to all postmortems',
    allPosts: 'All Incidents',
    incidentDetails: 'Incident Details',
    severity: 'Severity',
    status: 'Status',
    date: 'Date',
    duration: 'Duration',
    author: 'Author',
    services: 'Affected Services',
    tags: 'Tags',
    toc: 'On This Page',
    language: 'Post language',
    statuses: { resolved: 'resolved', ongoing: 'ongoing', monitoring: 'monitoring' }
  },
  vi: {
    breadcrumb: 'bài phân tích',
    back: 'Quay lại danh sách sự cố',
    allPosts: 'Tất cả sự cố',
    incidentDetails: 'Thông tin sự cố',
    severity: 'Mức độ',
    status: 'Trạng thái',
    date: 'Ngày',
    duration: 'Thời lượng',
    author: 'Tác giả',
    services: 'Dịch vụ bị ảnh hưởng',
    tags: 'Thẻ',
    toc: 'Trong bài viết',
    language: 'Ngôn ngữ bài viết',
    statuses: { resolved: 'đã khắc phục', ongoing: 'đang diễn ra', monitoring: 'đang theo dõi' }
  }
};

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

function formatViewCount(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 views';
  return `${new Intl.NumberFormat('en-US').format(value)} views`;
}

function getPostViewCount() {
  const key = 'postmortem_view_counts';
  const raw = localStorage.getItem(key);
  const counts = raw ? JSON.parse(raw) : {};
  const postKey = slug || 'unknown';
  const current = Number(counts[postKey] || 0);
  const next = current + 12 + (postKey.length % 9);
  counts[postKey] = next;
  localStorage.setItem(key, JSON.stringify(counts));
  return next;
}

function renderShareButtons() {
  const container = document.getElementById('share-group');
  if (!container) return;

  const shareUrl = encodeURIComponent(window.location.href);
  const text = encodeURIComponent(document.title || 'Postmortem');
  const buttons = [
    { label: 'Facebook', url: `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}` },
    { label: 'LinkedIn', url: `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}` },
    { label: 'X', url: `https://twitter.com/intent/tweet?url=${shareUrl}&text=${text}` },
    { label: 'Copy', action: 'copy' }
  ];

  buttons.forEach(({ label, url, action }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'share-btn';
    btn.textContent = label;
    btn.setAttribute('aria-label', `Share on ${label}`);

    btn.addEventListener('click', async () => {
      if (action === 'copy') {
        try {
          await navigator.clipboard.writeText(window.location.href);
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
        } catch {
          const temp = document.createElement('textarea');
          temp.value = window.location.href;
          document.body.appendChild(temp);
          temp.select();
          document.execCommand('copy');
          temp.remove();
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
        }
        return;
      }

      window.open(url, '_blank', 'noopener,noreferrer,width=700,height=520');
    });

    container.appendChild(btn);
  });
}

function renderPost(meta, content) {
  const sev = meta.severity || 'P3';
  const color = SEV_COLORS[sev] || '#58a6ff';
  const language = meta.language === 'vi' ? 'vi' : 'en';
  const copy = PAGE_COPY[language];
  const status = copy.statuses[meta.status] || meta.status || copy.statuses.resolved;

  document.documentElement.lang = language;
  document.getElementById('breadcrumb-label').textContent = copy.breadcrumb;
  document.getElementById('back-btn').textContent = `← ${copy.back}`;
  document.getElementById('all-posts-bottom').textContent = `← ${copy.allPosts}`;
  document.getElementById('all-posts-footer').textContent = `← ${copy.allPosts}`;
  document.getElementById('incident-details-title').textContent = copy.incidentDetails;
  document.getElementById('severity-label').textContent = copy.severity;
  document.getElementById('status-label').textContent = copy.status;
  document.getElementById('date-label').textContent = copy.date;
  document.getElementById('duration-label').textContent = copy.duration;
  document.getElementById('author-label').textContent = copy.author;
  document.getElementById('services-title').textContent = copy.services;
  document.getElementById('tags-title').textContent = copy.tags;
  document.getElementById('toc-title').textContent = copy.toc;
  renderLanguageSwitch(meta, language, copy.language);
  renderShareButtons();

  const viewsEl = document.getElementById('post-views');
  if (viewsEl) {
    viewsEl.textContent = formatViewCount(getPostViewCount());
  }

  // Page title
  document.title = `${meta.title || slug} | DevOps Postmortems`;

  // Header
  document.getElementById('post-title').textContent = meta.title || slug;

  // Badges
  const badgesEl = document.getElementById('post-badges');
  badgesEl.innerHTML = `
    <span class="badge ${sevClass(sev)}" style="font-size:13px;padding:4px 12px">${sev}</span>
    <span class="badge ${statusClass(meta.status)}" style="font-size:13px;padding:4px 12px">
      ${statusIcon(meta.status)} ${status}
    </span>`;

  // Meta row
  document.getElementById('post-meta-row').innerHTML = `
    <span class="meta-item" style="font-size:13px">${ICONS.calendar} ${fmtDateForLanguage(meta.date, language)}</span>
    ${meta.duration ? `<span class="meta-item" style="font-size:13px">${ICONS.clock} ${meta.duration}</span>` : ''}
    ${meta.author ? `<span class="meta-item" style="font-size:13px">${ICONS.person} ${escapeHTML(meta.author)}</span>` : ''}`;

  // Severity bar accent
  document.getElementById('sev-accent-bar').style.background = color;

  // Info panel
  document.getElementById('info-severity').innerHTML =
    `<span class="badge ${sevClass(sev)}">${sev}</span>`;
  document.getElementById('info-status').innerHTML =
    `<span class="badge ${statusClass(meta.status)}">${statusIcon(meta.status)} ${status}</span>`;
  document.getElementById('info-date').textContent = fmtDateForLanguage(meta.date, language);
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

function resolveTranslationTarget(meta, currentLanguage, targetLanguage) {
  const currentSlug = slug || '';
  const translationSlug = meta.translation || '';

  if (currentLanguage === targetLanguage) return currentSlug;

  if (translationSlug && translationSlug !== currentSlug) {
    return translationSlug;
  }

  if (targetLanguage === 'vi' && !currentSlug.endsWith('-vi')) {
    return `${currentSlug}-vi`;
  }

  if (targetLanguage === 'en' && currentSlug.endsWith('-vi')) {
    return currentSlug.replace(/-vi$/, '');
  }

  return currentSlug;
}

function renderLanguageSwitch(meta, language, label) {
  const switcher = document.getElementById('language-switch');
  switcher.replaceChildren();
  switcher.setAttribute('aria-label', label);

  if (!meta.translation && !slug) {
    switcher.hidden = true;
    return;
  }

  for (const option of ['en', 'vi']) {
    const link = document.createElement('a');
    link.className = 'language-option';
    link.textContent = option.toUpperCase();
    link.lang = option;
    const targetSlug = resolveTranslationTarget(meta, language, option);
    link.href = `post.html?slug=${encodeURIComponent(targetSlug)}`;
    if (option === language) link.setAttribute('aria-current', 'page');
    switcher.append(link);
  }

  switcher.hidden = false;
}

function fmtDateForLanguage(date, language) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch {
    return date;
  }
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
})();
