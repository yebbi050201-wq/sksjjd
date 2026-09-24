import { NextRequest, NextResponse } from "next/server";
import {
  getAnimeList,
  getAnimeListFiltered,
  searchAnime,
  LINKKF_GENRES,
  LINKKF_YEARS,
  LINKKF_TYPES,
} from "@/lib/linkkf";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 무료 스크레이퍼로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";
  const tab = searchParams.get("tab") || "airing";
  const page = parseInt(searchParams.get("page") || "1", 10) || 1;
  const section = searchParams.get("section") || "2";
  const genre = searchParams.get("genre") || "";
  const year = searchParams.get("year") || "";
  const typeLang = searchParams.get("type") || "";
  const period = (searchParams.get("period") || "day") as "day" | "week" | "month" | "all";

  let result;
  if (q) {
    result = await searchAnime(q, page);
  } else if (tab === "list") {
    result = await getAnimeListFiltered({ section, genre, year, typeLang, page });
  } else if (tab === "top") {
    result = await getAnimeList({ category: "top", page, period });
  } else {
    // Default 'airing'
    result = await getAnimeListFiltered({ section: "2", page });
  }

  const noCache = searchParams.get("nocache") === "1";
  const cacheControl =
    noCache || q
      ? "no-store"
      : "public, s-maxage=300, stale-while-revalidate=600";

  return NextResponse.json(
    {
      ...result,
      tab,
      filters: {
        genres: LINKKF_GENRES,
        years: LINKKF_YEARS,
        types: LINKKF_TYPES,
      },
    },
    {
      headers: {
        "Cache-Control": cacheControl,
      },
    }
  );
}
