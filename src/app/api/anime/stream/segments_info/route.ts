import { NextRequest, NextResponse } from "next/server";
import { getAnimeDetail, getEpisodeStream } from "@/lib/linkkf";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const OP_SEARCH_SEC = 240; // 앞 4분
const ED_SEARCH_SEC = 150; // 뒤 2.5분

interface SegmentItem {
  duration: number;
  url: string;
  offset: number;
}

async function fetchM3u8(url: string, refUrl = "https://playv2.sub3.top/", cookie = ""): Promise<{ content: string; finalUrl: string }> {
  await assertSafeProxyUrl(url);

  const origin = (() => {
    try {
      return new URL(refUrl).origin;
    } catch {
      return "https://playv2.sub3.top";
    }
  })();

  const refCandidates = [
    refUrl,
    (() => {
      try { return new URL(url).origin + "/"; } catch { return refUrl; }
    })(),
    "https://playv2.sub3.top/",
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastStatus = 0;
  for (const candidateRef of refCandidates) {
    let candidateOrigin = origin;
    try { candidateOrigin = new URL(candidateRef).origin; } catch {}

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: candidateRef,
      Origin: candidateOrigin,
      Accept: "*/*",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      ...(cookie ? { Cookie: cookie } : {}),
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (res.ok) {
        return { content: await res.text(), finalUrl: url };
      }
      lastStatus = res.status;
      if (res.status !== 403 && res.status !== 429 && res.status < 500) break;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  throw new Error(`Failed to fetch m3u8: ${lastStatus}`);
}

async function parseM3u8Recursive(url: string, refUrl = "https://playv2.sub3.top/", cookie = ""): Promise<SegmentItem[]> {
  const { content, finalUrl } = await fetchM3u8(url, refUrl, cookie);

  // 마스터 플레이리스트 처리
  if (content.includes("#EXT-X-STREAM-INF")) {
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith("#")) {
        const nextUrl = new URL(line, finalUrl).toString();
        return parseM3u8Recursive(nextUrl, refUrl, cookie);
      }
    }
  }

  const lines = content.split(/\r?\n/);
  const segments: SegmentItem[] = [];
  let curDur = 0;
  let curOffset = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#EXTINF:")) {
      const match = trimmed.match(/[\d.]+/);
      curDur = match ? parseFloat(match[0]) : 0;
    } else if (trimmed && !trimmed.startsWith("#")) {
      const absUrl = new URL(trimmed, finalUrl).toString();
      segments.push({
        duration: curDur,
        url: absUrl,
        offset: curOffset,
      });
      curOffset += curDur;
    }
  }

  return segments;
}

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 프록시로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  let m3u8Url = searchParams.get("url")?.trim();
  let m3u8RefUrl = searchParams.get("ref")?.trim() || "https://playv2.sub3.top/";
  let mediaCookie = "";
  const animeId = searchParams.get("anime_id")?.trim();
  const ep = parseInt(searchParams.get("ep") || "1", 10) || 1;
  const isDub = searchParams.get("dub") === "1";

  try {
    // anime_id와 ep가 제공된 경우 회차 스트림 m3u8을 자동으로 찾기
    if (!m3u8Url && animeId) {
      const detail = await getAnimeDetail(animeId);
      if (detail) {
        const epList = isDub && detail.dub_episodes && detail.dub_episodes.length > 0
          ? detail.dub_episodes
          : detail.sub_episodes;
        const targetEp = epList.find((e) => e.number === ep) || epList[0];
        if (targetEp && targetEp.watch_url) {
          const streamInfo = await getEpisodeStream(targetEp.watch_url);
          if (streamInfo && streamInfo.m3u8_url) {
            m3u8Url = streamInfo.m3u8_url;
            // 실제 m3u8을 발급한 플레이어 URL을 Referer/Origin으로 유지
            m3u8RefUrl = streamInfo.player_url || targetEp.watch_url;
            mediaCookie = streamInfo.media_cookie || "";
          }
        }
      }
    }

    if (!m3u8Url) {
      return NextResponse.json(
        { success: false, message: "Missing url or anime_id+ep parameter" },
        { status: 400 }
      );
    }

    // Proxy url인 경우 원본 URL 추출
    if (m3u8Url.includes("/api/anime/stream/m3u8?url=")) {
      const u = new URL(m3u8Url, "http://localhost");
      m3u8Url = decodeURIComponent(u.searchParams.get("url") || m3u8Url);
    }

    try {
      await assertSafeProxyUrl(m3u8Url);
    } catch (e) {
      if (e instanceof UnsafeProxyUrlError) {
        return NextResponse.json(
          { success: false, message: `Blocked URL: ${e.message}` },
          { status: 400 }
        );
      }
      throw e;
    }

    const segments = await parseM3u8Recursive(m3u8Url, m3u8RefUrl, mediaCookie);
    if (segments.length === 0) {
      return NextResponse.json(
        { success: false, message: "No segments found in m3u8" },
        { status: 404 }
      );
    }

    const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);

    // 1. 오프닝 세그먼트 (앞 4분: 0 ~ 240초)
    const opEndLimit = Math.min(totalDuration, OP_SEARCH_SEC);
    const opSegments = segments
      .filter((s) => s.offset < opEndLimit && s.offset + s.duration > 0)
      .map((s) => ({
        duration: s.duration,
        offset: s.offset,
        url: s.url,
        proxyUrl: `/api/anime/stream/segment?url=${encodeURIComponent(s.url)}&ref=${encodeURIComponent(m3u8RefUrl)}&audio=1&cookie=${encodeURIComponent(mediaCookie)}`,
      }));

    // 2. 엔딩 세그먼트 (뒤 2.5분: max(0, totalDuration - 150) ~ totalDuration)
    const edStartLimit = Math.max(0, totalDuration - ED_SEARCH_SEC);
    const edSegments = segments
      .filter((s) => s.offset + s.duration > edStartLimit)
      .map((s) => ({
        duration: s.duration,
        offset: s.offset,
        url: s.url,
        proxyUrl: `/api/anime/stream/segment?url=${encodeURIComponent(s.url)}&ref=${encodeURIComponent(m3u8RefUrl)}&audio=1`,
      }));

    return NextResponse.json(
      {
        success: true,
        totalDuration: Math.round(totalDuration * 10) / 10,
        op: {
          startSec: 0,
          durationSec: opEndLimit,
          segments: opSegments,
        },
        ed: {
          startSec: Math.round(edStartLimit * 10) / 10,
          durationSec: Math.round((totalDuration - edStartLimit) * 10) / 10,
          segments: edSegments,
        },
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (error) {
    console.error("[segments_info error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "시청 정보를 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}
