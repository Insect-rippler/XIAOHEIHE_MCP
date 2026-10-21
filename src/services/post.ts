/** Post shape shared by search / feed / link lookups. */
export interface PostBrief {
  postId: string;
  title: string;
  author: string;
  authorId: string;
  textPreview: string;
  images: string[];
  tags: string[];
  stats: { likes: number; comments: number };
  createdAt: number;
  url: string;
  source: "feed" | "search" | "link";
}

/** Strip tags/entities from search titles and rich text. */
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Link bodies arrive either as plain HTML or as a JSON array of `text` / `html` / `img`
 * segments. Both are flattened to text plus image URLs.
 */
export function parseRichText(raw: unknown): { text: string; images: string[] } {
  if (typeof raw !== "string" || raw.trim() === "") return { text: "", images: [] };
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const parts: string[] = [];
        const images: string[] = [];
        for (const part of parsed) {
          if (!part || typeof part !== "object") continue;
          const segment = part as { type?: string; text?: string; url?: string };
          if (segment.type === "img" && segment.url) images.push(segment.url);
          if (segment.text) {
            parts.push(stripHtml(segment.text));
            for (const match of segment.text.matchAll(/<img[^>]+(?:data-original|src)=["']([^"']+)["']/gi)) {
              images.push(match[1]!);
            }
          } else if (segment.type === "html" && segment.url) {
            images.push(segment.url);
          }
        }
        return { text: parts.filter(Boolean).join("\n"), images: [...new Set(images)] };
      }
    } catch {
      /* fall through to HTML handling */
    }
  }
  const images = [...trimmed.matchAll(/<img[^>]+(?:data-original|src)=["']([^"']+)["']/gi)].map((m) => m[1]!);
  return { text: stripHtml(trimmed), images: [...new Set(images)] };
}

/** Extract a post id from a URL, a `link_id` parameter or a bare numeric id. */
export function resolvePostId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const linkMatch = trimmed.match(/\/bbs\/link\/(\d+)/);
  if (linkMatch) return linkMatch[1]!;
  const paramMatch = trimmed.match(/[?&](?:link_id|linkId)=(\d+)/);
  if (paramMatch) return paramMatch[1]!;
  return null;
}

export function postUrl(postId: string): string {
  return `https://www.xiaoheihe.cn/app/bbs/link/${postId}`;
}
