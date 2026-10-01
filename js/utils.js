// ─── marked.js v15 config ───────────────────────────────────
// marked v15 uses marked.use({ renderer }) instead of setOptions
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = tokens.map(t => t.raw || '').join('');
      const id = text.toLowerCase().replace(/[^\w]+/g, '-');
      return `<h${depth} id="${id}">${marked.parseInline(text)}</h${depth}>\n`;
    },
    code({ text, lang }) {
      return `<pre data-lang="${lang || 'code'}"><code>${escapeHtml(text)}</code></pre>\n`;
    }
  }
});

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Frontmatter parser ──────────────────────────────────────
function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]+?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const [key, ...rest] = line.split(':');
    if (!key) return;
    let val = rest.join(':').trim();
    // Array: ["a", "b"]
    const arr = val.match(/^\[(.*)\]$/);
    if (arr) {
      meta[key.trim()] = arr[1].split(',').map(s =>
        s.trim().replace(/^["']|["']$/g, '')
      );
    } else {
      meta[key.trim()] = val.replace(/^["']|["']$/g, '');
    }
  });

  return { meta, content: match[2] };
}

// ─── Severity helpers ────────────────────────────────────────
const SEV_COLORS = {
  P0: '#f85149', P1: '#f0883e', P2: '#d29922', P3: '#58a6ff'
};

function sevClass(sev) { return `badge-${(sev || 'P3').toLowerCase()}`; }
function statusClass(s) { return `badge-${(s || 'resolved').toLowerCase()}`; }

function statusIcon(s) {
  return s === 'resolved' ? '✓' : s === 'ongoing' ? '⚠' : '◉';
}

// ─── Date formatter ──────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  } catch { return d; }
}

// ─── SVG icons (inline) ─────────────────────────────────────
const ICONS = {
  calendar: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.75 0a.75.75 0 01.75.75V2h5V.75a.75.75 0 011.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0113.25 16H2.75A1.75 1.75 0 011 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 014.75 0zm0 3.5h-2a.25.25 0 00-.25.25V6h11V3.75a.25.25 0 00-.25-.25H11.5v.75a.75.75 0 01-1.5 0V3.5h-5v.75a.75.75 0 01-1.5 0V3.5z"/></svg>`,
  clock: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 8a7 7 0 1114 0A7 7 0 011 8zm7-5.25a.75.75 0 00-.75.75v5.25l2.75 1.587a.75.75 0 10.75-1.299L8.75 7.68V3.5A.75.75 0 008 2.75z"/></svg>`,
  person: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.561 8.073a6.005 6.005 0 013.432 6.932l-.528 1.6a.75.75 0 01-1.429-.467l.529-1.601a4.5 4.5 0 00-2.972-5.483.75.75 0 01.968-.98zM5.44 7.926a.75.75 0 01.968.98 4.5 4.5 0 00-2.972 5.483l.529 1.601a.75.75 0 01-1.429.467l-.528-1.6a6.005 6.005 0 013.432-6.932zM8 7a4 4 0 100-8 4 4 0 000 8z"/></svg>`,
  zap: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 9h3.5L6 16l6.5-9H9L11 0z"/></svg>`,
  search: `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M10.68 11.74a6 6 0 01-7.922-8.982 6 6 0 018.982 7.922l3.04 3.04a.749.749 0 01-.326 1.275.749.749 0 01-.734-.215L10.68 11.74zm-5.68.26a4.5 4.5 0 100-9 4.5 4.5 0 000 9z"/></svg>`,
  grid: `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M1 2.5A1.5 1.5 0 012.5 1h3A1.5 1.5 0 017 2.5v3A1.5 1.5 0 015.5 7h-3A1.5 1.5 0 011 5.5v-3zm8.5 0A1.5 1.5 0 0111 1h3a1.5 1.5 0 011.5 1.5v3A1.5 1.5 0 0114 7h-3a1.5 1.5 0 01-1.5-1.5v-3zm-8.5 8A1.5 1.5 0 012.5 9h3A1.5 1.5 0 017 10.5v3A1.5 1.5 0 015.5 15h-3A1.5 1.5 0 011 13.5v-3zm8.5 0A1.5 1.5 0 0111 9h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3a1.5 1.5 0 01-1.5-1.5v-3z"/></svg>`,
  list: `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M2 4.75a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 4a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H2.75A.75.75 0 012 8.75zm0 4a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H2.75A.75.75 0 012 12.75z"/></svg>`,
  arrow: `<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M6.75 7.793L2.03 3.07a.75.75 0 00-1.06 1.06L5.44 8.5 .97 12.87a.75.75 0 001.06 1.06L6.75 9.207l4.72 4.72a.75.75 0 001.06-1.06L8.06 8.5l4.47-4.47a.75.75 0 00-1.06-1.06L6.75 7.793z" transform="rotate(90 8 8)"/></svg>`
};

// ─── Expose helpers for index + post pages ───────────────────
window.BlogUtils = {
  parseFrontmatter,
  fmtDate,
  sevClass,
  statusClass,
  statusIcon,
  SEV_COLORS,
  ICONS,
  marked
};
