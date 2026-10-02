import re
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlencode


ROOT = Path(__file__).resolve().parent.parent
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
ET.register_namespace("", SITEMAP_NS)


def markdown_pages(directory, page_name):
    for path in sorted(directory.glob("*.md")):
        if path.name.startswith("_"):
            continue
        content = path.read_text(encoding="utf-8")
        date_match = re.search(r"^date:\s*[\"']?(\d{4}-\d{2}-\d{2})", content, re.MULTILINE)
        query = urlencode({"slug": path.stem})
        yield f"{page_name}?{query}", date_match.group(1) if date_match else None


def add_url(urlset, url, lastmod=None):
    entry = ET.SubElement(urlset, f"{{{SITEMAP_NS}}}url")
    ET.SubElement(entry, f"{{{SITEMAP_NS}}}loc").text = url
    if lastmod and re.fullmatch(r"\d{4}-\d{2}-\d{2}", lastmod):
        ET.SubElement(entry, f"{{{SITEMAP_NS}}}lastmod").text = lastmod


def main():
    domain_file = ROOT / "CNAME"
    domain = domain_file.read_text(encoding="utf-8").strip() if domain_file.exists() else ""
    if not domain:
        raise ValueError("CNAME must contain the canonical site domain")
    base_url = f"https://{domain}"

    urlset = ET.Element(f"{{{SITEMAP_NS}}}urlset")
    add_url(urlset, f"{base_url}/")
    add_url(urlset, f"{base_url}/blog.html")

    for relative_url, lastmod in markdown_pages(ROOT / "postmortems", "post.html"):
        add_url(urlset, f"{base_url}/{relative_url}", lastmod)

    for relative_url, lastmod in markdown_pages(ROOT / "blogs", "blog-post.html"):
        add_url(urlset, f"{base_url}/{relative_url}", lastmod)

    tree = ET.ElementTree(urlset)
    ET.indent(tree, space="  ")
    (ROOT / "sitemap.xml").write_bytes(
        ET.tostring(tree.getroot(), encoding="utf-8", xml_declaration=True) + b"\n"
    )
    print(f"Generated sitemap.xml with {len(urlset)} URLs")


if __name__ == "__main__":
    main()