import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
BLOG_DIR = ROOT / "blogs"


def parse_value(value):
    value = value.strip()
    if value.startswith("["):
        return json.loads(value)
    if value.startswith('"') and value.endswith('"'):
        return json.loads(value)
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value


def parse_frontmatter(text):
    match = re.match(r"^---\s*\n([\s\S]+?)\n---\s*\n?", text)
    if not match:
        raise ValueError("Markdown article must start with YAML frontmatter")

    metadata = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = parse_value(value)
    return metadata


def main():
    articles = []
    for path in sorted(BLOG_DIR.glob("*.md")):
        if path.name.startswith("_"):
            continue
        metadata = parse_frontmatter(path.read_text(encoding="utf-8"))
        articles.append({"slug": path.stem, "filename": path.name, **metadata})

    articles.sort(key=lambda article: article.get("date", ""), reverse=True)
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(articles),
        "articles": articles,
    }
    (BLOG_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Generated blogs/manifest.json with {len(articles)} article(s)")


if __name__ == "__main__":
    main()