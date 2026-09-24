import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import AdmZip from "adm-zip";

export const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

export interface SubtitleResult {
  name: string;
  episode: number;
  orig_filename: string;
  format: "ASS" | "VTT";
  is_ass: boolean;
  content: string; // VTT text or raw ASS string
  url?: string;
}

export interface CreatorInfo {
  name: string;
  episode: string;
  update_date: string;
  website: string;
  is_current_ep: boolean;
}

// 1. Title cleaner
export function cleanTitle(text: string): string {
  if (!text) return "";
  let t = text.replace(/\[.*?\]|\(.*?\)|【.*?】|<.*?>|~.*?~/g, " ");
  t = t.replace(/[^\w\s가-힣a-zA-Z0-9]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// 2. Safe filename
export function safeFilename(text: string): string {
  return text.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").replace(/^_+|_+$/g, "");
}

// 3. Season parser
export function parseSeason(text: string): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*기|\b(\d+)(?:st|nd|rd|th)\b|season\s*(\d+)|\bs(\d+)\b/i);
  if (m) {
    for (let i = 1; i <= 4; i++) {
      if (m[i]) return parseInt(m[i], 10);
    }
  }
  const m2 = text.match(/(?<=[가-힣a-zA-Z])([2-9])(?=\s|$|[^\w가-힣])/);
  if (m2) {
    return parseInt(m2[1], 10);
  }
  return null;
}

// 4. Episode numbers parser
export function parseEpisodes(text: string): number[] {
  if (!text) return [];
  const base = text.split(/[\\/]/).pop() || text;
  const eps = new Set<number>();

  // Range patterns: 1-12, 1~12, 01~12화
  const rangeRegex = /(?:^|[^\d])0*(\d{1,3})\s*(?:~|-|_|\.\.|to)\s*0*(\d{1,3})\s*(?:화|편|ep|e|#)?/gi;
  let match: RegExpExecArray | null;
  while ((match = rangeRegex.exec(base)) !== null) {
    const s = parseInt(match[1], 10);
    const e = parseInt(match[2], 10);
    if (s >= 1 && s < e && e <= 150 && e - s <= 100) {
      if (![720, 1080, 480].includes(s) && ![720, 1080, 480].includes(e)) {
        for (let i = s; i <= e; i++) eps.add(i);
      }
    }
  }

  // Explicit units: 01화, 1편, ep2, #3
  const explicitRegex = /(?:^|[^\d])0*(\d{1,3})\s*(?:화|편|ep|e|#)/gi;
  while ((match = explicitRegex.exec(base)) !== null) {
    const val = parseInt(match[1], 10);
    if (val >= 1 && val <= 200) eps.add(val);
  }

  // Fallback: standalone numbers after removing season tokens
  if (eps.size === 0) {
    let clean = base.replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ");
    clean = clean.replace(/\b\d+\s*기\b/g, " ");
    clean = clean.replace(/season\s*\d+/gi, " ");
    clean = clean.replace(/\bs\d+\b/gi, " ");
    clean = clean.replace(/(?<=[가-힣a-zA-Z])\d(?=\s|$|\.|\-|_)/g, " ");

    const numRegex = /(?:^|[^\d])0*(\d{1,3})(?:[^\d]|$)/g;
    while ((match = numRegex.exec(clean)) !== null) {
      const val = parseInt(match[1], 10);
      if (
        ![720, 1080, 480, 2020, 2021, 2022, 2023, 2024, 2025, 2026].includes(val) &&
        val >= 1 &&
        val <= 200
      ) {
        eps.add(val);
      }
    }
  }

  return Array.from(eps).sort((a, b) => a - b);
}

// 5. Decode text buffer with encoding fallback (UTF-8, UTF-16, CP949, EUC-KR)
export function decodeSubtitleBuffer(buf: Buffer): string {
  // UTF-16 BOM or null-byte pattern
  if (
    (buf[0] === 0xff && buf[1] === 0xfe) ||
    (buf[0] === 0xfe && buf[1] === 0xff) ||
    buf.subarray(0, 50).includes(0x00)
  ) {
    try {
      const s = iconv.decode(buf, "utf-16");
      if (s.toLowerCase().includes("<sync") || s.toLowerCase().includes("<sami") || s.includes("-->")) {
        return s;
      }
    } catch {}
  }

  for (const enc of ["utf-8", "cp949", "euc-kr", "utf-16"]) {
    try {
      const s = iconv.decode(buf, enc);
      if (
        s.toLowerCase().includes("<sync") ||
        s.toLowerCase().includes("<sami") ||
        s.includes("-->") ||
        s.toLowerCase().includes("[script info]")
      ) {
        return s;
      }
    } catch {}
  }

  // Fallback UTF-8
  return buf.toString("utf-8");
}

function msToTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const remMs = ms % 1000;
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(remMs).padStart(3, "0")}`;
}

// 6. SMI/SRT to WebVTT converter
export function convertToVtt(rawText: string, origExt: string): { content: string; ext: string } {
  const lowerExt = origExt.toLowerCase();
  if (lowerExt === ".ass" || lowerExt === ".ssa") {
    return { content: rawText, ext: ".ass" };
  }

  const lowerText = rawText.toLowerCase();

  // SAMI (.smi) Parser
  if (lowerExt === ".smi" || lowerText.includes("<sync") || lowerText.includes("<sami")) {
    const matches: Array<{ startMs: number; text: string }> = [];
    const syncRegex = /<SYNC\s+Start=(\d+)>(?:<P[^>]*>)?([\s\S]*?)(?=<SYNC|\Z)/gi;
    let m: RegExpExecArray | null;

    while ((m = syncRegex.exec(rawText)) !== null) {
      const startMs = parseInt(m[1], 10);
      let clean = m[2].replace(/<br\s*\/?>/gi, "\n");
      clean = clean.replace(/<(?!(\/)?(?:font|i|b|u)\b)[^>]+>/gi, "").trim();
      clean = clean.replace(/&nbsp;/gi, " ").trim();
      if (clean && clean.toLowerCase() !== "&nbsp;") {
        matches.push({ startMs, text: clean });
      }
    }

    if (matches.length > 0) {
      const lines = ["WEBVTT", ""];
      for (let i = 0; i < matches.length; i++) {
        const item = matches[i];
        const endMs = i + 1 < matches.length ? matches[i + 1].startMs : item.startMs + 3000;
        lines.push(`${msToTime(item.startMs)} --> ${msToTime(endMs)}`);
        lines.push(item.text);
        lines.push("");
      }
      return { content: lines.join("\n"), ext: ".vtt" };
    }
  }

  // SRT Parser
  if (lowerExt === ".srt" || rawText.includes("-->")) {
    const vtt = "WEBVTT\n\n" + rawText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    return { content: vtt, ext: ".vtt" };
  }

  return { content: rawText, ext: origExt };
}

// 7. In-memory ZIP extractor & subtitle reader
export function extractSubtitleFromBuffer(
  buffer: Buffer,
  episodeNumber: number,
  urlPath: string
): { filename: string; orig_filename: string; content: string; format: "ASS" | "VTT"; is_ass: boolean } | null {
  const isZip =
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    urlPath.toLowerCase().endsWith(".zip");

  if (isZip) {
    try {
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();
      const subEntries = zipEntries.filter((entry) => {
        const name = entry.entryName.toLowerCase();
        return (
          !name.startsWith("__macosx") &&
          (name.endsWith(".ass") ||
            name.endsWith(".ssa") ||
            name.endsWith(".smi") ||
            name.endsWith(".srt") ||
            name.endsWith(".vtt"))
        );
      });

      if (subEntries.length === 0) return null;

      const extPriority: Record<string, number> = {
        ".ass": 1,
        ".ssa": 2,
        ".smi": 3,
        ".srt": 4,
        ".vtt": 5,
      };

      let matchedEntry: AdmZip.IZipEntry | null = null;
      let matchedDecName = "";

      const candidates: Array<{ priority: number; entry: AdmZip.IZipEntry; decName: string }> = [];

      for (const entry of subEntries) {
        let decName = entry.entryName;
        try {
          // CP949 decode attempt for Korean filenames inside zip
          decName = iconv.decode(entry.rawEntryName, "cp949");
        } catch {}

        for (const nameToCheck of [decName, entry.entryName]) {
          const epNums = parseEpisodes(nameToCheck);
          if (epNums.includes(episodeNumber)) {
            const ext = "." + (entry.name.split(".").pop() || "").toLowerCase();
            candidates.push({
              priority: extPriority[ext] || 99,
              entry,
              decName,
            });
            break;
          }
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.priority - b.priority);
        matchedEntry = candidates[0].entry;
        matchedDecName = candidates[0].decName;
      } else if (subEntries.length === 1) {
        matchedEntry = subEntries[0];
        matchedDecName = matchedEntry.name;
      }

      if (matchedEntry) {
        const rawBuf = matchedEntry.getData();
        const rawText = decodeSubtitleBuffer(rawBuf);
        const origExt = "." + (matchedEntry.name.split(".").pop() || "").toLowerCase();
        const { content, ext } = convertToVtt(rawText, origExt);
        const isAss = ext === ".ass" || ext === ".ssa";

        return {
          filename: `sub${ext}`,
          orig_filename: matchedDecName || matchedEntry.name,
          content,
          format: isAss ? "ASS" : "VTT",
          is_ass: isAss,
        };
      }
    } catch (e) {
      console.error("[Zip Extractor error]:", e);
    }
  } else {
    const rawText = decodeSubtitleBuffer(buffer);
    const textLower = rawText.slice(0, 500).toLowerCase();

    // Reject HTML content completely (e.g. Google Drive web viewer/login pages)
    if (
      textLower.includes("<!doctype html") ||
      textLower.includes("<html") ||
      textLower.includes("<head>")
    ) {
      return null;
    }

    const isAss = textLower.includes("[script info]") || textLower.includes("dialogue:");
    const isSmi = textLower.includes("<sami") || textLower.includes("<sync");
    const isSrt = /^\s*\d+\s*[\r\n]+\d{2}:\d{2}/.test(rawText.slice(0, 100)) || rawText.includes("-->");

    if (isAss || isSmi || isSrt) {
      const origExt = isAss ? ".ass" : isSmi ? ".smi" : ".srt";
      const { content, ext } = convertToVtt(rawText, origExt);
      const isAssResult = ext === ".ass" || ext === ".ssa";
      let displayFn = urlPath.split("/").pop() || `subtitle${origExt}`;
      if (displayFn.includes("?") || displayFn.length > 60) {
        displayFn = `subtitle${origExt}`;
      }

      return {
        filename: `sub${ext}`,
        orig_filename: displayFn,
        content,
        format: isAssResult ? "ASS" : "VTT",
        is_ass: isAssResult,
      };
    }
  }

  return null;
}

// 8. Convert Google Drive and cloud links to direct download URLs
export function convertToDirectDownloadUrl(url: string): string {
  if (!url) return url;
  const driveMatch = url.match(
    /(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/
  );
  if (driveMatch && driveMatch[1]) {
    return `https://drive.usercontent.google.com/download?id=${driveMatch[1]}&export=download`;
  }
  return url;
}

// 9. Download file helper with timeout & Google Drive support
export async function downloadFileWithTimeout(
  url: string,
  referer?: string,
  timeoutMs = 4500
): Promise<Buffer | null> {
  try {
    const headers: Record<string, string> = { ...HEADERS };
    if (referer) headers["Referer"] = referer;

    const directUrl = convertToDirectDownloadUrl(url);

    let res = await fetch(directUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Fallback for Google Drive
    if (!res.ok && directUrl.includes("drive.usercontent.google.com")) {
      const driveMatch = url.match(
        /(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/
      );
      if (driveMatch && driveMatch[1]) {
        res = await fetch(
          `https://docs.google.com/uc?export=download&id=${driveMatch[1]}&confirm=t`,
          {
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          }
        );
      }
    }

    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // Reject HTML responses
    if (buf.length > 0) {
      const sample = buf.subarray(0, 300).toString("utf-8").toLowerCase();
      if (sample.includes("<!doctype html") || sample.includes("<html")) {
        return null;
      }
    }

    return buf;
  } catch {
    return null;
  }
}

// 9. Kairan blog subtitle searcher
export async function findKairanSubtitle(
  title: string,
  episodeNumber: number,
  timeoutMs = 3500
): Promise<SubtitleResult | null> {
  try {
    const targetSeason = parseSeason(title);
    const targetEp = episodeNumber;

    let cleanBase = title.replace(/[\(\[\{<~].*?[\]\)\}>~]/g, "").trim();
    cleanBase = cleanBase.replace(/\s+\d+기$/g, "").trim();
    cleanBase = cleanBase.replace(/\b\d+(?:st|nd|rd|th)\b/gi, "").trim();
    cleanBase = cleanBase.replace(/season\s*\d+/gi, "").trim();
    cleanBase = cleanTitle(cleanBase);

    const words = cleanBase
      .split(/\s+/)
      .filter((w) => !["시즌", "더빙", "자막", "극장판", "애니"].includes(w));
    const searchTerm = words.length >= 2 ? words.slice(0, 2).join(" ") : words[0] || cleanBase;
    if (!searchTerm) return null;

    const queries: string[] = [];
    if (targetSeason) {
      queries.push(`${searchTerm} ${targetSeason}th ${targetEp}`);
      queries.push(`${searchTerm} ${targetSeason}기 ${targetEp}`);
      queries.push(`${searchTerm} ${targetSeason}th`);
      queries.push(`${searchTerm} ${targetSeason}기`);
    }
    queries.push(`${searchTerm} ${targetEp}화`);
    queries.push(`${searchTerm} ${targetEp}`);
    queries.push(`${searchTerm}`);

    for (const q of queries) {
      const searchUrl = `https://kairan03.blogspot.com/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(searchUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      let matchedPostUrl = "";
      $(".post, .date-outer, .entry").each((_, p) => {
        if (matchedPostUrl) return;
        const titleEl = $(p).find(".post-title a, h3 a, .entry-title a").first();
        if (!titleEl.length) return;

        const postTitle = titleEl.text().trim();
        const postUrl = titleEl.attr("href")?.trim() || "";
        if (!postUrl || postUrl.includes("report-abuse")) return;
        if (!postTitle.includes(words[0])) return;

        const postSeason = parseSeason(postTitle);
        const postEps = parseEpisodes(postTitle);

        if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
          return;
        }

        if (postEps.includes(targetEp)) {
          matchedPostUrl = postUrl;
        }
      });

      if (matchedPostUrl) {
        // Download post page to find attachment link
        const postRes = await fetch(matchedPostUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!postRes.ok) continue;

        const postHtml = await postRes.text();
        const $p = cheerio.load(postHtml);

        let subDownloadUrl = "";
        $p("a[href]").each((_, a) => {
          if (subDownloadUrl) return;
          const href = $p(a).attr("href")?.trim() || "";
          const text = $p(a).text().trim().toLowerCase();
          if (
            href.includes("drive.google.com") ||
            href.includes("docs.google.com") ||
            href.endsWith(".zip") ||
            href.endsWith(".ass") ||
            href.endsWith(".smi") ||
            href.endsWith(".srt") ||
            text.includes("자막") ||
            text.includes("다운로드")
          ) {
            subDownloadUrl = href;
          }
        });

        // Fallback: search postHtml for Google Drive link
        if (!subDownloadUrl) {
          const driveMatch = postHtml.match(
            /https?:\/\/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/
          );
          if (driveMatch) {
            subDownloadUrl = driveMatch[0];
          }
        }

        if (subDownloadUrl) {
          const buf = await downloadFileWithTimeout(subDownloadUrl, matchedPostUrl, timeoutMs + 1500);
          if (buf && buf.length > 100) {
            const extracted = extractSubtitleFromBuffer(buf, targetEp, subDownloadUrl);
            if (extracted) {
              return {
                name: "카이란",
                episode: targetEp,
                orig_filename:
                  extracted.orig_filename.startsWith("view?") || extracted.orig_filename.startsWith("subtitle")
                    ? `${cleanBase} ${targetEp}화.${extracted.format.toLowerCase()}`
                    : extracted.orig_filename,
                format: extracted.format,
                is_ass: extracted.is_ass,
                content: extracted.content,
              };
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("[Kairan Subtitle] error:", e);
  }
  return null;
}

// 10. Creator blog search (Tistory, Naver Blog, Blogspot)
export async function searchBlogForEpisode(
  domain: string,
  website: string,
  animeTitle: string,
  episodeNumber: number,
  timeoutMs = 5000
): Promise<string | null> {
  const targetSeason = parseSeason(animeTitle);
  const targetEp = episodeNumber;

  let cleanBase = animeTitle.replace(/[\(\[\{<~].*?[\]\)\}>~]/g, "").trim();
  cleanBase = cleanBase.replace(/\s+\d+기$/g, "").trim();
  cleanBase = cleanBase.replace(/\b\d+(?:st|nd|rd|th)\b/gi, "").trim();
  cleanBase = cleanBase.replace(/season\s*\d+/gi, "").trim();
  cleanBase = cleanTitle(cleanBase);

  const words = cleanBase
    .split(/\s+/)
    .filter((w) => !["시즌", "더빙", "자막", "극장판", "애니"].includes(w));
  const searchTerm = words.length >= 2 ? words.slice(0, 2).join(" ") : words[0] || cleanBase;

  const queries = [
    `${searchTerm} ${targetEp}화`,
    `${searchTerm} ${String(targetEp).padStart(2, "0")}`,
    `${searchTerm}`,
  ];

  try {
    // 1. Google Blogger (blogspot.com)
    if (domain.includes("blogspot.com")) {
      for (const q of queries) {
        const searchUrl = `https://${domain}/search?q=${encodeURIComponent(q)}`;
        const res = await fetch(searchUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        let foundUrl = "";
        $(".post-title a, h3 a, .entry-title a").each((_, a) => {
          if (foundUrl) return;
          const title = $(a).text().trim();
          const href = $(a).attr("href")?.trim() || "";
          if (!href || href.includes("report-abuse")) return;

          const postSeason = parseSeason(title);
          const postEps = parseEpisodes(title);

          if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
            return;
          }

          if (postEps.includes(targetEp)) {
            foundUrl = href;
          }
        });

        if (foundUrl) return foundUrl;
      }
    }
    // 2. Tistory
    else if (domain.includes("tistory.com")) {
      for (const q of queries) {
        const searchUrl = `https://${domain}/search/${encodeURIComponent(q)}`;
        const res = await fetch(searchUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        let foundUrl = "";
        $(".link_article, .post-item a, .title a, a[href*='/entry/']").each((_, a) => {
          if (foundUrl) return;
          const title = $(a).text().trim();
          const href = $(a).attr("href")?.trim() || "";
          if (!href) return;

          const postSeason = parseSeason(title);
          const postEps = parseEpisodes(title);

          if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
            return;
          }

          if (postEps.includes(targetEp)) {
            foundUrl = new URL(href, website).toString();
          }
        });

        if (foundUrl) return foundUrl;
      }
    }
    // 3. Naver Blog
    else if (domain.includes("blog.naver.com")) {
      const m = website.match(/blog\.naver\.com\/([^/?#]+)/);
      if (m) {
        const blogId = m[1];
        for (const q of queries.slice(0, 2)) {
          const searchUrl = `https://blog.naver.com/PostSearchList.naver?blogId=${blogId}&searchText=${encodeURIComponent(q)}`;
          const res = await fetch(searchUrl, {
            headers: HEADERS,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) continue;

          const html = await res.text();
          const $ = cheerio.load(html);

          let foundUrl = "";
          $("a.link, .title a, a[href*='logNo=']").each((_, a) => {
            if (foundUrl) return;
            const href = $(a).attr("href")?.trim() || "";
            const title = $(a).text().trim();
            if (!href) return;

            const postSeason = parseSeason(title);
            const postEps = parseEpisodes(title);

            if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
              return;
            }

            if (postEps.includes(targetEp)) {
              foundUrl = href;
            }
          });

          if (foundUrl) return foundUrl;
        }
      }
    }
  } catch (e) {
    console.warn("[searchBlogForEpisode error]:", e);
  }
  return null;
}

// 11. Fetch creator subtitle from their blog post (jcore와 100% 동일한 강력한 추출 엔진)
export async function fetchCreatorSubtitle(
  creatorName: string,
  website: string,
  animeTitle: string,
  episodeNumber: number,
  timeoutMs = 5000
): Promise<SubtitleResult | null> {
  if (!website) return null;
  try {
    const domain = new URL(website).hostname.toLowerCase();
    const targetSeason = parseSeason(animeTitle);

    // 단일 페이지에서 자막 파일(첨부파일/구글드라이브/다운로드링크) 추출 헬퍼 함수
    const tryExtractFromPage = async (targetUrl: string): Promise<SubtitleResult | null> => {
      try {
        let postUrl = targetUrl;
        const reqHeaders: Record<string, string> = { ...HEADERS };

        // 네이버 블로그: 프레임셋 우회용 PostView.naver URL로 자동 변환
        if (domain.includes("blog.naver.com")) {
          const m = targetUrl.match(/blog\.naver\.com\/([^/?&]+)\/(\d+)/) ||
                    targetUrl.match(/blog\.naver\.com\/([^/?&]+).*?[?&]logNo=(\d+)/);
          if (m) {
            postUrl = `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}`;
          }
          reqHeaders["Referer"] = "https://blog.naver.com/";
        }

        const res = await fetch(postUrl, {
          headers: reqHeaders,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;

        const html = await res.text();
        const $ = cheerio.load(html);

        // 1) 티스토리 첨부파일 (tfile, attachment, kakaocdn.net)
        if (domain.includes("tistory.com")) {
          const links: string[] = [];
          $('a[href*="tfile"], a[href*="attachment"], a[href*="kakaocdn.net"]').each((_, a) => {
            const href = $(a).attr("href")?.trim();
            if (href) links.push(new URL(href, postUrl).toString());
          });

          for (const dlUrl of links) {
            const buf = await downloadFileWithTimeout(dlUrl, postUrl, timeoutMs + 1000);
            if (buf && buf.length > 50) {
              const extracted = extractSubtitleFromBuffer(buf, episodeNumber, dlUrl);
              if (extracted) {
                return {
                  name: creatorName,
                  episode: episodeNumber,
                  orig_filename: extracted.orig_filename,
                  format: extracted.format,
                  is_ass: extracted.is_ass,
                  content: extracted.content,
                };
              }
            }
          }
        }

        // 2) 네이버 블로그 첨부파일 (download.blog.naver.com, blogfiles.naver.net, attach)
        else if (domain.includes("blog.naver.com")) {
          const links: string[] = [];
          $('a[href*="download.blog.naver.com"], a[href*="blogfiles.naver.net"], a[href*="attach"]').each((_, a) => {
            const href = $(a).attr("href")?.trim();
            if (href) links.push(href);
          });

          for (const dlUrl of links) {
            const buf = await downloadFileWithTimeout(dlUrl, "https://blog.naver.com/", timeoutMs + 1000);
            if (buf && buf.length > 50) {
              const extracted = extractSubtitleFromBuffer(buf, episodeNumber, dlUrl);
              if (extracted) {
                return {
                  name: creatorName,
                  episode: episodeNumber,
                  orig_filename: extracted.orig_filename,
                  format: extracted.format,
                  is_ass: extracted.is_ass,
                  content: extracted.content,
                };
              }
            }
          }
        }

        // 3) 구글 블로거 / 구글 드라이브 첨부 링크
        const gdriveMatches = html.match(
          /https?:\/\/(?:drive\.google\.com\/(?:file\/d\/|open\?id=)|docs\.google\.com\/uc\?id=)([a-zA-Z0-9_-]{25,})/g
        );
        if (gdriveMatches && gdriveMatches.length > 0) {
          for (const gUrl of gdriveMatches) {
            const buf = await downloadFileWithTimeout(gUrl, postUrl, timeoutMs + 1500);
            if (buf && buf.length > 50) {
              const extracted = extractSubtitleFromBuffer(buf, episodeNumber, gUrl);
              if (extracted) {
                return {
                  name: creatorName,
                  episode: episodeNumber,
                  orig_filename: extracted.orig_filename,
                  format: extracted.format,
                  is_ass: extracted.is_ass,
                  content: extracted.content,
                };
              }
            }
          }
        }

        // 4) 일반 링크 (.zip, .smi, .srt, .ass, .vtt)
        const fileLinks: string[] = [];
        $("a[href]").each((_, a) => {
          const href = $(a).attr("href")?.trim() || "";
          const text = $(a).text().trim().toLowerCase();
          if (
            href.endsWith(".zip") ||
            href.endsWith(".smi") ||
            href.endsWith(".srt") ||
            href.endsWith(".ass") ||
            href.endsWith(".ssa") ||
            href.endsWith(".vtt") ||
            text.includes(".zip") ||
            text.includes(".smi") ||
            text.includes(".ass") ||
            text.includes(".srt") ||
            text.includes("자막 다운")
          ) {
            try {
              fileLinks.push(new URL(href, postUrl).toString());
            } catch {}
          }
        });

        for (const fUrl of fileLinks) {
          const buf = await downloadFileWithTimeout(fUrl, postUrl, timeoutMs + 1000);
          if (buf && buf.length > 50) {
            const extracted = extractSubtitleFromBuffer(buf, episodeNumber, fUrl);
            if (extracted) {
              return {
                name: creatorName,
                episode: episodeNumber,
                orig_filename: extracted.orig_filename,
                format: extracted.format,
                is_ass: extracted.is_ass,
                content: extracted.content,
              };
            }
          }
        }
      } catch (err) {
        console.warn(`[tryExtractFromPage error] ${targetUrl}:`, err);
      }
      return null;
    };

    // 🌟 1단계: 초기 등록 링크(website) 자체가 해당 회차 글인지 먼저 확인 (jcore 방식)
    let isInitialUrlCurrentEp = false;
    try {
      const initRes = await fetch(website, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4000),
      });
      if (initRes.ok) {
        const initHtml = await initRes.text();
        const $init = cheerio.load(initHtml);
        const pageTitle = $init("title").text().trim() || "";
        const pSeason = parseSeason(`${pageTitle} ${website}`);
        const pEps = parseEpisodes(`${pageTitle} ${website}`);

        const seasonOk = (targetSeason === null || pSeason === null || targetSeason === pSeason);
        if (seasonOk && pEps.includes(episodeNumber)) {
          isInitialUrlCurrentEp = true;
        }
      }
    } catch {}

    if (isInitialUrlCurrentEp) {
      const initExtracted = await tryExtractFromPage(website);
      if (initExtracted) return initExtracted;
    }

    // 🌟 2단계: 초기 URL이 해당 회차가 아니거나 추출 실패 시, 블로그 전체에서 현재 회차 포스트 자동 탐색
    const matchedPostUrl = await searchBlogForEpisode(domain, website, animeTitle, episodeNumber, timeoutMs);
    if (matchedPostUrl) {
      const searchExtracted = await tryExtractFromPage(matchedPostUrl);
      if (searchExtracted) return searchExtracted;
    }
  } catch (e) {
    console.error(`[fetchCreatorSubtitle error] ${creatorName}:`, e);
  }
  return null;
}

// 12. Anissia API query for subtitle creators
export async function getAnissiaCreators(
  title: string,
  episodeNumber: number,
  timeoutMs = 3500
): Promise<CreatorInfo[]> {
  const results: CreatorInfo[] = [];
  try {
    const cleanFull = cleanTitle(title);
    const korPart = title.replace(/[a-zA-Z].*$/, "").trim();
    const cleanKor = cleanTitle(korPart);
    const query = cleanKor && cleanKor.length >= 2 ? cleanKor : cleanFull;

    const url = `https://api.anissia.net/anime/list/0?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });

    let content: Array<{ animeNo: number; subject: string }> = [];
    if (res.ok) {
      const json = await res.json();
      content = json?.data?.content || [];
    }

    const targetSeason = parseSeason(title);
    let matchedAnime: { animeNo: number; subject: string } | null = null;

    for (const item of content) {
      const itemSeason = parseSeason(item.subject);
      if (targetSeason === null && (itemSeason === null || itemSeason === 1)) {
        matchedAnime = item;
        break;
      }
      if (targetSeason !== null && itemSeason === targetSeason) {
        matchedAnime = item;
        break;
      }
    }
    if (!matchedAnime && content.length > 0) {
      matchedAnime = content[0];
    }

    // Fallback: 단어 분리 검색
    if (!matchedAnime) {
      const words = query
        .split(/\s+/)
        .filter((w) => !["시즌", "더빙", "자막", "극장판", "애니", "1기", "2기", "3기", "4기", "5기"].includes(w));
      const fallbackQuery = words.length >= 2 ? words.slice(0, 2).join(" ") : words[0] || "";
      if (fallbackQuery && fallbackQuery !== query) {
        const url2 = `https://api.anissia.net/anime/list/0?q=${encodeURIComponent(fallbackQuery)}`;
        const res2 = await fetch(url2, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res2.ok) {
          const json2 = await res2.json();
          const c2 = json2?.data?.content || [];
          for (const item of c2) {
            const subj = item.subject || "";
            if (words.some((w) => w.length >= 2 && subj.includes(w))) {
              matchedAnime = item;
              break;
            }
          }
        }
      }
    }

    if (matchedAnime && matchedAnime.animeNo) {
      const capUrl = `https://api.anissia.net/anime/caption/animeNo/${matchedAnime.animeNo}`;
      const capRes = await fetch(capUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (capRes.ok) {
        const capJson = await capRes.json();
        const captions = capJson?.data || [];
        const seenNames = new Set<string>();

        for (const c of captions) {
          const name = (c.name || "제작자").trim();
          if (seenNames.has(name)) continue;
          seenNames.add(name);

          const epStr = String(c.episode || "");
          const isCurrent = epStr.includes(String(episodeNumber));
          results.push({
            name,
            episode: epStr,
            update_date: (c.updDt || "").replace("T", " ").slice(0, 16),
            website: (c.website || "").trim(),
            is_current_ep: isCurrent,
          });
        }
      }
    }
  } catch (e) {
    console.error("[getAnissiaCreators error]:", e);
  }
  return results;
}

// 13. High-level parallel searcher with 13-Second Safety Guard
export async function searchAllSubtitlesParallel(
  title: string,
  episodeNumber: number,
  maxTotalTimeMs = 13000
): Promise<{ subtitles: SubtitleResult[]; creators: CreatorInfo[] }> {
  // Create an overall timeout promise that resolves at 13 seconds
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), maxTotalTimeMs);
  });

  const workerPromise = (async () => {
    // 1. Fetch Anissia creators and Kairan search concurrently
    const [anissiaCreators, kairanSub] = await Promise.all([
      getAnissiaCreators(title, episodeNumber, 3500),
      findKairanSubtitle(title, episodeNumber, 3500),
    ]);

    const collectedSubs: SubtitleResult[] = [];
    if (kairanSub) {
      collectedSubs.push(kairanSub);
    }

    // 2. Filter valid creators who have an active blog for this episode
    const candidateCreators = anissiaCreators.filter(
      (c) => c.website && c.website.startsWith("http")
    );

    // Limit to top 4 creators to avoid excessive concurrency
    const topCreators = candidateCreators.slice(0, 4);

    // 3. Parallel fetch creator subtitles with individual 3.5s timeouts
    const creatorSubPromises = topCreators.map((c) =>
      fetchCreatorSubtitle(c.name, c.website, title, episodeNumber, 3500)
    );

    const settled = await Promise.allSettled(creatorSubPromises);
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) {
        collectedSubs.push(s.value);
      }
    }

    return {
      subtitles: collectedSubs,
      creators: anissiaCreators,
    };
  })();

  try {
    const winner = await Promise.race([workerPromise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    if (winner) {
      return winner;
    }
    // If timed out at 13s, return whatever is empty or basic fallback safely
    return { subtitles: [], creators: [] };
  } catch {
    clearTimeout(timeoutHandle!);
    return { subtitles: [], creators: [] };
  }
}
