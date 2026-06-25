import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Index } from "@upstash/vector";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local") });

const URLS_FILE = resolve(process.cwd(), "urls.txt");
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const REQUEST_DELAY_MS = 500;

type ChunkMetadata = {
  title: string;
  url: string;
  images: string[];
  id: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function readUrls(filePath: string): string[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function toAbsoluteUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function isElement(node: unknown): node is cheerio.Element {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    (node as { type: string }).type === "tag"
  );
}

function inlineToMarkdown(
  $: CheerioAPI,
  node: cheerio.AnyNode,
  baseUrl: string,
): string {
  if (node.type === "text") {
    return $(node).text();
  }

  if (!isElement(node)) {
    return "";
  }

  const $node = $(node);
  const tag = node.tagName.toLowerCase();
  const children = $node
    .contents()
    .toArray()
    .map((child) => inlineToMarkdown($, child, baseUrl))
    .join("");

  switch (tag) {
    case "br":
      return "\n";
    case "a": {
      const href = $node.attr("href");
      const text = children.trim();
      if (!href) return text;
      return `[${text || href}](${toAbsoluteUrl(href, baseUrl)})`;
    }
    case "strong":
    case "b":
      return children ? `**${children}**` : "";
    case "em":
    case "i":
      return children ? `*${children}*` : "";
    case "code":
      return `\`${$node.text()}\``;
    default:
      return children;
  }
}

function headingLevel($el: cheerio.Cheerio<cheerio.Element>): number {
  const heading = $el.find("h1, h2, h3, h4, h5, h6").first();
  if (heading.length > 0) {
    return Number(heading.prop("tagName")?.toLowerCase().replace("h", "")) || 2;
  }
  return 2;
}

function listToMarkdown(
  $: CheerioAPI,
  $list: cheerio.Cheerio<cheerio.Element>,
  baseUrl: string,
  ordered: boolean,
): string {
  const items = $list
    .children("li")
    .toArray()
    .map((li, index) => {
      const text = inlineToMarkdown($, li, baseUrl).replace(/\s+/g, " ").trim();
      const prefix = ordered ? `${index + 1}. ` : "- ";
      return `${prefix}${text}`;
    })
    .filter(Boolean);

  return items.length > 0 ? `${items.join("\n")}\n\n` : "";
}

function tableToMarkdown(
  $: CheerioAPI,
  $table: cheerio.Cheerio<cheerio.Element>,
  baseUrl: string,
): string {
  const rows = $table
    .find("tr")
    .toArray()
    .map((row) =>
      $(row)
        .find("th, td")
        .toArray()
        .map((cell) =>
          inlineToMarkdown($, cell, baseUrl).replace(/\s+/g, " ").trim(),
        )
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean);

  return rows.length > 0 ? `${rows.join("\n")}\n\n` : "";
}

function blockToMarkdown(
  $: CheerioAPI,
  node: cheerio.AnyNode,
  baseUrl: string,
): string {
  if (!isElement(node)) {
    return "";
  }

  const $node = $(node);
  const className = $node.attr("class") ?? "";

  if (className.includes("intercom-interblocks-image")) {
    const img = $node.find("img").first();
    const src = img.attr("src");
    if (!src) return "";
    const alt = (img.attr("alt") ?? "").replace(/\s+/g, " ").trim();
    return `![${alt}](${toAbsoluteUrl(src, baseUrl)})\n\n`;
  }

  if (
    className.includes("intercom-interblocks-subheading") ||
    $node.is("h1, h2, h3, h4, h5, h6")
  ) {
    const text = inlineToMarkdown($, node, baseUrl).replace(/\s+/g, " ").trim();
    if (!text) return "";
    const level = headingLevel($node);
    return `${"#".repeat(level)} ${text}\n\n`;
  }

  if (
    className.includes("intercom-interblocks-ordered-nested-list") ||
    $node.is("ol")
  ) {
    return listToMarkdown($, $node.is("ol") ? $node : $node.find("ol").first(), baseUrl, true);
  }

  if (
    className.includes("intercom-interblocks-unordered-nested-list") ||
    $node.is("ul")
  ) {
    return listToMarkdown($, $node.is("ul") ? $node : $node.find("ul").first(), baseUrl, false);
  }

  if (className.includes("intercom-interblocks-table") || $node.is("table")) {
    return tableToMarkdown($, $node.is("table") ? $node : $node.find("table").first(), baseUrl);
  }

  if (className.includes("intercom-interblocks-paragraph") || $node.is("p")) {
    const text = inlineToMarkdown($, node, baseUrl).replace(/\s+/g, " ").trim();
    return text ? `${text}\n\n` : "";
  }

  if ($node.is("article, div, section, main")) {
    return $node
      .children()
      .toArray()
      .map((child) => blockToMarkdown($, child, baseUrl))
      .join("");
  }

  if ($node.is("li")) {
    const text = inlineToMarkdown($, node, baseUrl).replace(/\s+/g, " ").trim();
    return text ? `${text}\n` : "";
  }

  return "";
}

function extractTitle($: CheerioAPI): string {
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(element).html() ?? "");
      if (parsed?.["@type"] === "Article" && parsed.headline) {
        return String(parsed.headline).trim();
      }
    } catch {
      // ignore invalid JSON-LD blocks
    }
  }

  const pageTitle = $("title").text().split("|")[0]?.trim();
  return pageTitle || "Untitled";
}

function extractArticleMarkdown(html: string, pageUrl: string): {
  title: string;
  markdown: string;
} {
  const $ = cheerio.load(html);
  const title = extractTitle($ as CheerioAPI);

  const articleRoot =
    $(".article_body article").first().length > 0
      ? $(".article_body article").first()
      : $(".article_body").first();

  if (articleRoot.length === 0) {
    throw new Error("Nu am găsit conținutul articolului (.article_body).");
  }

  const markdown = articleRoot
    .children()
    .toArray()
    .map((child) => blockToMarkdown($ as CheerioAPI, child, pageUrl))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!markdown) {
    throw new Error("Articolul nu conține text după extragere.");
  }

  return { title, markdown };
}

function articleSlugFromUrl(url: string): string {
  const match = new URL(url).pathname.match(/\/articles\/([^/?#]+)/);
  if (!match?.[1]) {
    throw new Error(`Nu pot extrage slug-ul articolului din URL: ${url}`);
  }
  return match[1];
}

function chunkText(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const lastNewline = slice.lastIndexOf("\n");
      const lastSpace = slice.lastIndexOf(" ");
      const breakAt =
        lastNewline > chunkSize * 0.5
          ? lastNewline
          : lastSpace > chunkSize * 0.5
            ? lastSpace
            : slice.length;
      end = start + breakAt;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function extractImageUrls(markdown: string): string[] {
  return Array.from(
    markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g),
    (match) => match[1],
  );
}

function stripImageMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildChunkId(articleSlug: string, chunkIndex: number): string {
  return `${articleSlug}--${chunkIndex}`;
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "conqueror-rag-ingest/1.0",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main(): Promise<void> {
  const restUrl = process.env.UPSTASH_VECTOR_REST_URL;
  const restToken = process.env.UPSTASH_VECTOR_REST_TOKEN;

  if (!restUrl || !restToken) {
    throw new Error(
      "Lipsesc UPSTASH_VECTOR_REST_URL sau UPSTASH_VECTOR_REST_TOKEN în .env.local",
    );
  }

  const index = new Index<ChunkMetadata>({ url: restUrl, token: restToken });
  const urls = readUrls(URLS_FILE);

  console.log(`Încărcat ${urls.length} URL-uri din urls.txt\n`);

  const perArticleCounts: Array<{ url: string; title: string; chunks: number }> =
    [];
  let totalChunks = 0;
  let failedPages = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    try {
      console.log(`[${i + 1}/${urls.length}] Procesez: ${url}`);
      const html = await fetchPage(url);
      const { title, markdown } = extractArticleMarkdown(html, url);
      const articleSlug = articleSlugFromUrl(url);
      const markdownChunks = chunkText(markdown);

      const upsertPayload = markdownChunks.map((chunkMarkdown, chunkIndex) => {
        const id = buildChunkId(articleSlug, chunkIndex);
        const images = extractImageUrls(chunkMarkdown);
        const data = stripImageMarkdown(chunkMarkdown);

        return {
          id,
          data,
          metadata: {
            id,
            title,
            url,
            images,
          },
        };
      });

      if (upsertPayload.length === 0) {
        throw new Error("Nu s-au generat chunk-uri pentru articol.");
      }

      await index.upsert(upsertPayload);

      perArticleCounts.push({ url, title, chunks: upsertPayload.length });
      totalChunks += upsertPayload.length;

      console.log(
        `  ✓ "${title}" → ${upsertPayload.length} chunk-uri upsert-ate`,
      );
    } catch (error) {
      failedPages += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Eroare la ${url}: ${message}`);
    }

    if (i < urls.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log("\n--- Rezumat ---");
  for (const entry of perArticleCounts) {
    console.log(`• ${entry.title}: ${entry.chunks} chunk-uri`);
    console.log(`  ${entry.url}`);
  }

  console.log(`\nTotal chunk-uri upsert-ate: ${totalChunks}`);
  console.log(`Articole reușite: ${perArticleCounts.length}/${urls.length}`);
  if (failedPages > 0) {
    console.log(`Articole eșuate: ${failedPages}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
