(() => {
  const slug = new URLSearchParams(location.search).get('slug');
  const apiBase = (window.POSTMORTEM_API_BASE || '').replace(/\/+$/, '');
  const { parseFrontmatter, fmtDate, marked, setPageSEO } = window.BlogUtils;

  function escapeHTML(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  async function loadArticle() {
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
      showError('Đường dẫn bài viết không hợp lệ.');
      return;
    }

    try {
      const response = await fetch(`blogs/${encodeURIComponent(slug)}.md`);
      if (!response.ok) throw new Error('Không tìm thấy bài viết.');
      const { meta, content } = parseFrontmatter(await response.text());

      const title = meta.title || slug;
      const description = meta.summary || 'Bài viết kỹ thuật về AWS, Kubernetes và DevOps.';
      const canonicalUrl = `/blog-post.html?slug=${encodeURIComponent(slug)}`;
      setPageSEO({
        title: `${title} | Knowledge Blog`,
        description,
        url: canonicalUrl,
        language: meta.language || 'vi',
        schema: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: title,
          description,
          datePublished: meta.date,
          dateModified: meta.updated || meta.date,
          inLanguage: meta.language || 'vi',
          author: { '@type': 'Person', name: meta.author || 'DevOps-PostMortem' },
          publisher: { '@type': 'Organization', name: 'DevOps-PostMortem' },
          mainEntityOfPage: { '@type': 'WebPage', '@id': new URL(canonicalUrl, location.origin).href },
          keywords: meta.tags || []
        }
      });
      document.getElementById('article-category').textContent = meta.category || 'DevOps';
      document.getElementById('article-title').textContent = meta.title || slug;
      document.getElementById('article-summary').textContent = meta.summary || '';
      document.getElementById('article-meta').innerHTML = `
        <span class="meta-item">${escapeHTML(fmtDate(meta.date))}</span>
        ${meta.author ? `<span class="meta-item">${escapeHTML(meta.author)}</span>` : ''}
        ${(meta.tags || []).map(tag => `<span class="meta-item">#${escapeHTML(tag)}</span>`).join('')}`;
      document.getElementById('article-body').innerHTML = marked.parse(content);
      initEngagement();
    } catch (error) {
      showError(error.message);
    }
  }

  function getViewerId() {
    const storageKey = 'postmortem_viewer_id';
    let viewerId = localStorage.getItem(storageKey);
    if (!viewerId) {
      viewerId = crypto.randomUUID();
      localStorage.setItem(storageKey, viewerId);
    }
    return viewerId;
  }

  function renderEngagement(stats) {
    document.getElementById('blog-views').textContent =
      `${new Intl.NumberFormat('vi-VN').format(stats.views || 0)} lượt xem`;
    const likeButton = document.getElementById('blog-like-button');
    likeButton.textContent = `${stats.liked ? 'Đã thích' : 'Thích'} · ${new Intl.NumberFormat('vi-VN').format(stats.likes || 0)}`;
    likeButton.dataset.liked = String(Boolean(stats.liked));
    likeButton.setAttribute('aria-pressed', String(Boolean(stats.liked)));
  }

  async function initEngagement() {
    const views = document.getElementById('blog-views');
    const likeButton = document.getElementById('blog-like-button');
    const engagementSlug = `blog-${slug}`;

    if (!apiBase) {
      views.textContent = 'Lượt xem chưa khả dụng';
      likeButton.textContent = 'Like chưa khả dụng';
      return;
    }

    likeButton.disabled = false;
    likeButton.addEventListener('click', async () => {
      likeButton.disabled = true;
      try {
        const response = await fetch(`${apiBase}/api/posts/${encodeURIComponent(engagementSlug)}/like`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewerId: getViewerId(), liked: likeButton.dataset.liked !== 'true' })
        });
        if (!response.ok) throw new Error(`Like API returned ${response.status}`);
        renderEngagement(await response.json());
      } catch (error) {
        console.warn('Could not update article like', error);
        likeButton.textContent = 'Like chưa khả dụng';
      } finally {
        likeButton.disabled = likeButton.textContent === 'Like chưa khả dụng';
      }
    });

    try {
      const response = await fetch(`${apiBase}/api/posts/${encodeURIComponent(engagementSlug)}/views`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewerId: getViewerId() })
      });
      if (!response.ok) throw new Error(`Views API returned ${response.status}`);
      renderEngagement(await response.json());
    } catch (error) {
      console.warn('Article analytics is unavailable', error);
      views.textContent = 'Lượt xem chưa khả dụng';
      likeButton.textContent = 'Like chưa khả dụng';
      likeButton.disabled = true;
    }
  }

  function showError(message) {
    document.getElementById('article-title').textContent = 'Không tải được bài viết';
    document.getElementById('article-body').innerHTML = `<p class="blog-empty">${escapeHTML(message)}</p>`;
  }

  loadArticle();
})();