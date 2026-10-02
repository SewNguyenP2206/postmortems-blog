(() => {
  const searchInput = document.getElementById('blog-search');
  const categorySelect = document.getElementById('blog-category');
  const list = document.getElementById('blog-list');
  const results = document.getElementById('blog-results');
  let articles = [];

  function escapeHTML(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function render() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const category = categorySelect.value;
    const filtered = articles.filter(article => {
      const matchesCategory = category === 'all' || article.category === category;
      const searchable = [article.title, article.summary, article.category, ...(article.tags || [])]
        .join(' ').toLocaleLowerCase();
      return matchesCategory && searchable.includes(query);
    });

    results.textContent = `${filtered.length} bài viết`;
    list.innerHTML = filtered.length ? filtered.map(article => `
      <a class="knowledge-card" href="blog-post.html?slug=${encodeURIComponent(article.slug)}">
        <div class="knowledge-card-top">
          <span class="knowledge-category">${escapeHTML(article.category || 'DevOps')}</span>
          <time datetime="${escapeHTML(article.date)}">${escapeHTML(window.BlogUtils.fmtDate(article.date))}</time>
        </div>
        <h2>${escapeHTML(article.title || article.slug)}</h2>
        <p>${escapeHTML(article.summary || '')}</p>
        <div class="knowledge-card-footer">
          <span>${(article.tags || []).map(tag => `#${escapeHTML(tag)}`).join(' ')}</span>
          <span>${escapeHTML(article.author || '')} <span aria-hidden="true">→</span></span>
        </div>
      </a>`).join('') : '<p class="blog-empty">Không tìm thấy bài viết phù hợp.</p>';
  }

  async function loadArticles() {
    try {
      const response = await fetch('blogs/manifest.json');
      if (!response.ok) throw new Error('Không tải được danh mục bài viết.');
      const manifest = await response.json();
      articles = (manifest.articles || []).sort((a, b) => new Date(b.date) - new Date(a.date));

      [...new Set(articles.map(article => article.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'vi'))
        .forEach(category => categorySelect.add(new Option(category, category)));

      render();
    } catch (error) {
      list.innerHTML = `<p class="blog-empty">${escapeHTML(error.message)}</p>`;
      results.textContent = '';
    }
  }

  searchInput.addEventListener('input', render);
  categorySelect.addEventListener('change', render);
  loadArticles();
})();