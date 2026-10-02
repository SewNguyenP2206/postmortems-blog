(() => {
  const slug = new URLSearchParams(location.search).get('slug');
  const { parseFrontmatter, fmtDate, marked } = window.BlogUtils;

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

      document.documentElement.lang = meta.language || 'vi';
      document.title = `${meta.title || slug} | Knowledge Blog`;
      document.getElementById('article-category').textContent = meta.category || 'DevOps';
      document.getElementById('article-title').textContent = meta.title || slug;
      document.getElementById('article-summary').textContent = meta.summary || '';
      document.getElementById('article-meta').innerHTML = `
        <span class="meta-item">${escapeHTML(fmtDate(meta.date))}</span>
        ${meta.author ? `<span class="meta-item">${escapeHTML(meta.author)}</span>` : ''}
        ${(meta.tags || []).map(tag => `<span class="meta-item">#${escapeHTML(tag)}</span>`).join('')}`;
      document.getElementById('article-body').innerHTML = marked.parse(content);
    } catch (error) {
      showError(error.message);
    }
  }

  function showError(message) {
    document.getElementById('article-title').textContent = 'Không tải được bài viết';
    document.getElementById('article-body').innerHTML = `<p class="blog-empty">${escapeHTML(message)}</p>`;
  }

  loadArticle();
})();