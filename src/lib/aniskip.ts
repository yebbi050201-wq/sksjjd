export const ANILIST_URL = "https://graphql.anilist.co";
export const ANISKIP_URL = "https://api.aniskip.com/v2/skip-times";

export interface SkipInterval {
  type: "op" | "ed" | "mixed-op" | "mixed-ed";
  label: "오프닝" | "엔딩";
  start: number;
  end: number;
}

const malIdCache: Record<string, number> = {};
const skipCache: Record<string, SkipInterval[]> = {};

function cleanSearchTitle(text: string): string {
  if (!text) return "";
  let t = text.replace(/\[.*?\]|\(.*?\)|【.*?】|<.*?>|~.*?~/g, " ");
  t = t.replace(/[^\w\s가-힣a-zA-Z0-9ぁ-んァ-ヶー一-龥]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

export async function getJapaneseTitleFromAnissia(koreanTitle: string): Promise<string> {
  try {
    const koMatch = koreanTitle.match(/^[가-힣0-9\s~!?.,-]+/);
    let clean = koMatch ? koMatch[0].trim() : cleanSearchTitle(koreanTitle);
    clean = clean.replace(/\s+\d+기$/g, "").trim();

    const words = clean.split(/\s+/);
    const searchTerms = [clean];
    if (words.length >= 2) searchTerms.push(words.slice(0, 2).join(" "));
    if (words.length > 0) searchTerms.push(words[0]);

    for (const term of searchTerms) {
      if (!term || term.length < 2) continue;
      const res = await fetch(`https://api.anissia.net/anime/list/0?q=${encodeURIComponent(term)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const json = await res.json();
        const content = json?.data?.content || [];
        if (content.length > 0) {
          const orig = content[0].originalSubject;
          if (orig) return orig;
        }
      }
    }
  } catch {}
  return "";
}

export async function findMalId(title: string, posterUrl = ""): Promise<number | null> {
  // 0. Poster AniList ID if present
  if (posterUrl) {
    const m = posterUrl.match(/\/anime\/(\d+)\//);
    if (m) {
      const anilistId = parseInt(m[1], 10);
      const cacheKey = `anilist_id_${anilistId}`;
      if (malIdCache[cacheKey]) return malIdCache[cacheKey];

      try {
        const query = `{ Media(id: ${anilistId}, type: ANIME) { id idMal } }`;
        const res = await fetch(ANILIST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          const malId = data?.data?.Media?.idMal;
          if (malId) {
            malIdCache[cacheKey] = malId;
            return malId;
          }
        }
      } catch {}
    }
  }

  const clean = cleanSearchTitle(title);
  if (malIdCache[clean]) return malIdCache[clean];

  // Season number
  const seasonMatch = title.match(/(\d+)\s*기|Season\s*(\d+)|(\d+)(?:nd|rd|th)\s*Season/i);
  let seasonNum: number | null = null;
  if (seasonMatch) {
    for (let i = 1; i < seasonMatch.length; i++) {
      if (seasonMatch[i]) {
        seasonNum = parseInt(seasonMatch[i], 10);
        break;
      }
    }
  }

  const koMatch = title.match(/^[가-힣0-9\s~!?.,-]+/);
  const enMatch = title.match(/[a-zA-Z][a-zA-Z0-9\s~!?.,-]*$/);

  const koPart = koMatch ? koMatch[0].trim() : "";
  const enPart = enMatch ? enMatch[0].trim() : "";

  const searchCandidates: string[] = [];

  if (enPart) {
    searchCandidates.push(enPart);
    if (seasonNum && !enPart.includes(String(seasonNum))) {
      searchCandidates.push(`${enPart} Season ${seasonNum}`);
    }
  }

  const jpTitle = await getJapaneseTitleFromAnissia(title);
  if (jpTitle) {
    searchCandidates.push(jpTitle);
    const cleanJp = jpTitle.replace(/第?\d+期|Season\s*\d+|2nd|3rd|4th|5th/gi, "").trim();
    if (cleanJp && cleanJp !== jpTitle) {
      searchCandidates.push(cleanJp);
    }
    if (seasonNum) {
      searchCandidates.push(`${cleanJp || jpTitle} Season ${seasonNum}`);
    }
  }

  if (koPart) {
    searchCandidates.push(koPart);
    const words = koPart.split(/\s+/);
    if (words.length >= 2) searchCandidates.push(words.slice(0, 2).join(" "));
  }

  searchCandidates.push(clean);

  for (const candidate of searchCandidates) {
    if (!candidate || candidate.length < 2) continue;
    const safeCand = candidate.replace(/["\\]/g, "").trim();
    const query = `{ Page(page: 1, perPage: 3) { media(search: "${safeCand}", type: ANIME) { id idMal title { romaji native english } } } }`;

    try {
      const res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = await res.json();
        const mediaList = data?.data?.Page?.media || [];
        for (const m of mediaList) {
          const malId = m?.idMal;
          if (malId) {
            malIdCache[clean] = malId;
            return malId;
          }
        }
      }
    } catch {}
  }

  return null;
}

export async function getSkipTimes(
  title: string,
  episodeNumber: number,
  episodeLength = 0,
  posterUrl = ""
): Promise<SkipInterval[]> {
  const cacheKey = `${title}_${episodeNumber}`;
  if (skipCache[cacheKey]) return skipCache[cacheKey];

  const malId = await findMalId(title, posterUrl);
  if (!malId) return [];

  try {
    const url = `${ANISKIP_URL}/${malId}/${episodeNumber}?types[]=op&types[]=ed&episodeLength=${episodeLength || 0}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];

    const data = await res.json();
    if (!data.found) return [];

    const results: SkipInterval[] = [];
    const seenIntervals = new Set<string>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of data.results || []) {
      const st = (item.skipType || "").toLowerCase() as "op" | "ed";
      const interval = item.interval || {};
      const startTime = parseFloat(interval.startTime || 0);
      const endTime = parseFloat(interval.endTime || 0);

      const duration = endTime - startTime;
      if (duration >= 15 && duration <= 240) {
        const intKey = `${Math.round(startTime * 10) / 10}_${Math.round(endTime * 10) / 10}`;
        if (!seenIntervals.has(intKey)) {
          seenIntervals.add(intKey);
          results.push({
            type: st,
            label: st === "op" ? "오프닝" : "엔딩",
            start: startTime,
            end: endTime,
          });
        }
      }
    }

    skipCache[cacheKey] = results;
    return results;
  } catch (e) {
    console.error("[AniSkip error]:", e);
    return [];
  }
}
