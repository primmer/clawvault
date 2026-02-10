import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SITE_URL = "https://versatly.github.io/clawvault";
const SITE_URL = normalizeUrl(
  process.env.CLAWVAULT_SITE_URL || process.env.SITE_URL || DEFAULT_SITE_URL,
);
const REPO_URL = "https://github.com/Versatly/clawvault";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const BLOG_DIR = path.join(ROOT_DIR, "blog");
const DOCS_DIR = path.join(ROOT_DIR, "docs");

function normalizeUrl(url) {
  return url.replace(/\/+$/, "");
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return {};
  const endIndex = raw.indexOf("\n---\n", 4);
  if (endIndex === -1) return {};

  const block = raw.slice(4, endIndex);
  const data = {};

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(" ") || line.startsWith("\t")) continue;
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    data[key] = stripQuotes(rawValue);
  }

  return data;
}

function parseInlineArray(rawValue) {
  if (!rawValue) return [];
  const trimmed = rawValue.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  return trimmed
    .slice(1, -1)
    .split(",")
    .map((item) => stripQuotes(item.trim()))
    .filter(Boolean);
}

function extractHeading(raw) {
  const lines = raw.split("\n");
  for (const line of lines) {
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return null;
}

function extractDescription(raw) {
  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "---" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("**Release Date:**")) continue;
    return trimmed;
  }
  return "ClawVault blog post update.";
}

function dateFromInputs(frontmatterDate, fileName, fallbackDate) {
  if (frontmatterDate) {
    const parsed = new Date(frontmatterDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const fileDateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})-/);
  if (fileDateMatch) {
    const parsed = new Date(fileDateMatch[1]);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return fallbackDate;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

async function loadBlogPosts() {
  const files = await readdir(BLOG_DIR);
  const postFiles = files.filter(
    (file) => file.endsWith(".md") && /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(file),
  );

  const posts = [];

  for (const fileName of postFiles) {
    const filePath = path.join(BLOG_DIR, fileName);
    const [raw, fileStats] = await Promise.all([
      readFile(filePath, "utf8"),
      stat(filePath),
    ]);

    const frontmatter = parseFrontmatter(raw);
    const slug = fileName.replace(/\.md$/, "");
    const title = frontmatter.title || extractHeading(raw) || slug;
    const description = frontmatter.description || extractDescription(raw);
    const tags = parseInlineArray(frontmatter.tags);
    const publishedAt = dateFromInputs(frontmatter.date, fileName, fileStats.mtime);

    posts.push({
      slug,
      title,
      description,
      tags,
      publishedAt,
      lastModified: fileStats.mtime,
      url: `${SITE_URL}/blog/${slug}/`,
    });
  }

  posts.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return posts;
}

async function loadDocsEntries() {
  const files = await readdir(DOCS_DIR);
  const docFiles = files.filter((file) => file.endsWith(".md"));
  const entries = [];

  for (const fileName of docFiles) {
    const filePath = path.join(DOCS_DIR, fileName);
    const fileStats = await stat(filePath);
    const slug = fileName.replace(/\.md$/, "");
    entries.push({
      url: `${SITE_URL}/docs/${slug}/`,
      lastModified: fileStats.mtime,
    });
  }

  return entries;
}

function buildSitemapXml({ readmeLastModified, blogPosts, docsEntries }) {
  const entries = [
    {
      url: `${SITE_URL}/`,
      changefreq: "weekly",
      priority: "1.0",
      lastModified: readmeLastModified,
    },
    {
      url: `${SITE_URL}/readme/`,
      changefreq: "weekly",
      priority: "0.9",
      lastModified: readmeLastModified,
    },
    {
      url: `${SITE_URL}/blog/`,
      changefreq: "daily",
      priority: "0.9",
      lastModified: blogPosts[0]?.lastModified || readmeLastModified,
    },
    ...blogPosts.map((post) => ({
      url: post.url,
      changefreq: "monthly",
      priority: "0.8",
      lastModified: post.lastModified,
    })),
    ...docsEntries.map((doc) => ({
      url: doc.url,
      changefreq: "monthly",
      priority: "0.7",
      lastModified: doc.lastModified,
    })),
  ];

  const urlXml = entries
    .map(
      (entry) => `  <url>
    <loc>${xmlEscape(entry.url)}</loc>
    <lastmod>${formatIsoDate(entry.lastModified)}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Auto-generated by generate-seo-assets.mjs -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlXml}
</urlset>
`;
}

function buildRssXml(blogPosts) {
  const feedUrl = `${SITE_URL}/blog/feed.xml`;
  const blogUrl = `${SITE_URL}/blog/`;
  const lastBuildDate = blogPosts[0]?.lastModified || new Date();

  const itemXml = blogPosts
    .map((post) => {
      const categories = post.tags
        .map((tag) => `    <category>${xmlEscape(tag)}</category>`)
        .join("\n");

      const categoriesBlock = categories ? `\n${categories}` : "";
      return `  <item>
    <title>${xmlEscape(post.title)}</title>
    <link>${xmlEscape(post.url)}</link>
    <guid isPermaLink="true">${xmlEscape(post.url)}</guid>
    <pubDate>${post.publishedAt.toUTCString()}</pubDate>
    <description>${xmlEscape(post.description)}</description>${categoriesBlock}
  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Auto-generated by generate-seo-assets.mjs -->
<!-- To update: npm run seo:generate -->
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>ClawVault Blog</title>
  <link>${xmlEscape(blogUrl)}</link>
  <description>Release notes, updates, and technical deep dives for ClawVault.</description>
  <language>en-us</language>
  <managingEditor>team@versatly.com (Versatly)</managingEditor>
  <generator>ClawVault SEO generator</generator>
  <lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>
  <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml" />
${itemXml}
</channel>
</rss>
`;
}

function buildRobotsTxt() {
  return `# Auto-generated by generate-seo-assets.mjs
User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

async function main() {
  const readmeStats = await stat(path.join(ROOT_DIR, "README.md"));
  const [blogPosts, docsEntries] = await Promise.all([
    loadBlogPosts(),
    loadDocsEntries(),
  ]);

  const sitemapXml = buildSitemapXml({
    readmeLastModified: readmeStats.mtime,
    blogPosts,
    docsEntries,
  });
  const rssXml = buildRssXml(blogPosts);
  const robotsTxt = buildRobotsTxt();

  await Promise.all([
    writeFile(path.join(ROOT_DIR, "sitemap.xml"), sitemapXml, "utf8"),
    writeFile(path.join(BLOG_DIR, "feed.xml"), rssXml, "utf8"),
    writeFile(path.join(ROOT_DIR, "robots.txt"), robotsTxt, "utf8"),
  ]);

  console.log(`Generated SEO assets using site URL: ${SITE_URL}`);
  console.log("- sitemap.xml");
  console.log("- blog/feed.xml");
  console.log("- robots.txt");
  console.log(`Indexed posts: ${blogPosts.length}`);
  console.log(`Indexed docs pages: ${docsEntries.length}`);
  console.log(`Repository reference: ${REPO_URL}`);
}

main().catch((error) => {
  console.error("Failed to generate SEO assets.");
  console.error(error);
  process.exit(1);
});
