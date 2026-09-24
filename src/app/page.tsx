import Navbar from "@/components/Navbar";
import AnimeCard from "@/components/AnimeCard";
import HistoryList, { HistoryItem } from "@/components/HistoryList";
import {
  getAnimeListFiltered,
  getAnimeList,
  searchAnime,
  LINKKF_GENRES,
  LINKKF_YEARS,
  LINKKF_TYPES,
  AnimeListItem,
} from "@/lib/linkkf";
import { getDb, initDb } from "@/lib/db";
import { checkAndPromoteNewEpisodes } from "@/lib/historyPromotion";
import { getCurrentUserId, requireAuth } from "@/lib/auth";
import Link from "next/link";
import { Flame, Tv, Filter, ChevronLeft, ChevronRight, Star, Clock } from "lucide-react";

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
  genre?: string;
  year?: string;
  type?: string;
  period?: "day" | "week" | "month" | "all";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // 인증 검사: 관리자 없으면 /setup 강제 이동, 미로그인이면 /login 강제 이동
  await requireAuth();

  const params = await searchParams;
  const tab = params.tab || (params.q ? "search" : "airing");
  const q = params.q?.trim() || "";
  const page = parseInt(params.page || "1", 10) || 1;
  const genre = params.genre || "";
  const year = params.year || "";
  const typeLang = params.type || "";
  const period = params.period || "day";

  let items: AnimeListItem[] = [];
  let historyItems: HistoryItem[] = [];
  let has_next = false;
  let total_pages = 1;

  if (q) {
    const res = await searchAnime(q, page);
    items = res.items;
    has_next = res.has_next;
    total_pages = res.total_pages;
  } else if (tab === "top") {
    const res = await getAnimeList({ category: "top", page: 1, period });
    items = res.items;
    has_next = res.has_next;
    total_pages = res.total_pages;
  } else if (tab === "list") {
    const res = await getAnimeListFiltered({ section: "2", genre, year, typeLang, page });
    items = res.items;
    has_next = res.has_next;
    total_pages = res.total_pages;
  } else if (tab === "favorites") {
    const sql = getDb();
    if (sql) {
      await initDb();
      try {
        const currentUserId = await getCurrentUserId();
        const rows = await sql`
          SELECT anime_id as id, anime_title as title, anime_poster as poster, '' as detail_url, '즐겨찾기' as remarks
          FROM anime_favorites
          WHERE user_id = ${currentUserId}
          ORDER BY created_at DESC;
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items = rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          poster: r.poster,
          detail_url: `/anime/${r.id}`,
          remarks: "★ 즐겨찾기",
        }));
      } catch {}
    }
  } else if (tab === "history") {
    const sql = getDb();
    if (sql) {
      await initDb();
      try {
        const currentUserId = await getCurrentUserId();
        await checkAndPromoteNewEpisodes(currentUserId);

        const rows = await sql`
          SELECT * FROM (
            SELECT DISTINCT ON (anime_id)
              id, anime_id, anime_title, anime_poster, episode_number, episode_title, watch_url, watch_time, duration, is_completed, updated_at
            FROM anime_history
            WHERE user_id = ${currentUserId}
            ORDER BY anime_id, updated_at DESC
          ) t
          ORDER BY updated_at DESC
          LIMIT 50;
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        historyItems = rows.map((r: any) => ({
          id: r.id,
          anime_id: r.anime_id,
          anime_title: r.anime_title,
          anime_poster: r.anime_poster || "",
          episode_number: r.episode_number,
          episode_title: r.episode_title || "",
          watch_url: r.watch_url,
          watch_time: parseFloat(r.watch_time || "0"),
          duration: parseFloat(r.duration || "0"),
          is_completed: Boolean(r.is_completed),
          updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        }));
      } catch (e) {
        console.error("Failed to fetch history:", e);
      }
    }
  } else {
    // Airing
    const res = await getAnimeListFiltered({ section: "2", page });
    items = res.items;
    has_next = res.has_next;
    total_pages = res.total_pages;
  }

  const buildUrl = (newParams: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (tab) p.set("tab", tab);
    if (q) p.set("q", q);
    if (genre) p.set("genre", genre);
    if (year) p.set("year", year);
    if (typeLang) p.set("type", typeLang);
    if (period) p.set("period", period);
    p.set("page", String(page));

    Object.entries(newParams).forEach(([k, v]) => {
      if (v === "") p.delete(k);
      else p.set(k, String(v));
    });

    return `/?${p.toString()}`;
  };

  return (
    <div className="min-h-screen bg-[#0b0f19]">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-purple-500/20 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/?tab=airing"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "airing"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Tv className="h-4 w-4" />
              신작 방영
            </Link>

            <Link
              href="/?tab=top"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "top"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Flame className="h-4 w-4" />
              인기 순위
            </Link>

            <Link
              href="/?tab=list"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "list"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Filter className="h-4 w-4" />
              카테고리 탐색
            </Link>

            <Link
              href="/?tab=favorites"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "favorites"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              즐겨찾기
            </Link>

            <Link
              href="/?tab=history"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "history"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Clock className="h-4 w-4 text-purple-400" />
              시청 기록
            </Link>
          </div>

          {/* Top Ranking Period Switcher */}
          {tab === "top" && (
            <div className="flex items-center gap-1 rounded-lg bg-slate-900/80 p-1 text-xs border border-purple-500/20">
              {(
                [
                  ["day", "일간"],
                  ["week", "주간"],
                  ["month", "월간"],
                  ["all", "전체"],
                ] as const
              ).map(([key, label]) => (
                <Link
                  key={key}
                  href={buildUrl({ period: key, page: 1 })}
                  className={`rounded-md px-2.5 py-1 transition ${
                    period === key ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Category Filters (Only on 'list' tab) */}
        {tab === "list" && (
          <div className="mt-6 space-y-4 rounded-2xl border border-purple-500/20 bg-slate-900/50 p-5 backdrop-blur-sm">
            {/* Types (TV / Movie / OVA) */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-bold text-purple-400 mr-2 min-w-[36px]">타입:</span>
              <Link
                href={buildUrl({ type: "", page: 1 })}
                className={`rounded-lg px-2.5 py-1 transition ${
                  !typeLang ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                전체
              </Link>
              {LINKKF_TYPES.map(([tKey, tLabel]) => (
                <Link
                  key={tKey}
                  href={buildUrl({ type: tKey, page: 1 })}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    typeLang === tKey ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {tLabel}
                </Link>
              ))}
            </div>

            {/* Genres */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-bold text-purple-400 mr-2 min-w-[36px]">장르:</span>
              <Link
                href={buildUrl({ genre: "", page: 1 })}
                className={`rounded-lg px-2.5 py-1 transition ${
                  !genre ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                전체
              </Link>
              {LINKKF_GENRES.map(([gKey, gLabel]) => (
                <Link
                  key={gKey}
                  href={buildUrl({ genre: gKey, page: 1 })}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    genre === gKey ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {gLabel}
                </Link>
              ))}
            </div>

            {/* Years (1990 ~ 현재 연도 전체) */}
            <div className="flex items-start gap-1.5 text-xs">
              <span className="font-bold text-purple-400 mr-2 min-w-[36px] pt-1">연도:</span>
              <div className="flex flex-wrap items-center gap-1.5 max-h-28 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-purple-500/30">
                <Link
                  href={buildUrl({ year: "", page: 1 })}
                  className={`rounded-lg px-2.5 py-1 transition ${
                    !year ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  전체
                </Link>
                {LINKKF_YEARS.map((y) => (
                  <Link
                    key={y}
                    href={buildUrl({ year: y, page: 1 })}
                    className={`rounded-lg px-2.5 py-1 transition ${
                      year === y ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {y}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Search Header info */}
        {q && (
          <div className="mt-6">
            <h2 className="text-xl font-bold text-white">
              &quot;{q}&quot; 검색 결과 ({items.length}개)
            </h2>
          </div>
        )}

        {/* History Tab vs General Grid */}
        {tab === "history" ? (
          <div className="mt-6">
            <HistoryList initialItems={historyItems} />
          </div>
        ) : (
          <>
            {/* Anime Grid */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((anime) => (
                <AnimeCard key={anime.id} anime={anime} />
              ))}
            </div>

            {items.length === 0 && (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-slate-400">
                <p className="text-base font-semibold">
                  {tab === "favorites"
                    ? "등록된 즐겨찾기가 없습니다. 마음에 드는 작품을 추가해 보세요!"
                    : "작품 목록이 없습니다."}
                </p>
              </div>
            )}
          </>
        )}

        {/* Pagination */}
        {tab !== "top" && tab !== "favorites" && tab !== "history" && (
          <div className="mt-10 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link
                href={buildUrl({ page: page - 1 })}
                className="flex items-center gap-1 rounded-xl border border-purple-500/20 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 transition hover:border-purple-500 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
                이전
              </Link>
            )}

            <span className="px-4 py-2 text-sm font-semibold text-purple-300">
              {page} / {total_pages || 1} 페이지
            </span>

            {has_next && (
              <Link
                href={buildUrl({ page: page + 1 })}
                className="flex items-center gap-1 rounded-xl border border-purple-500/20 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 transition hover:border-purple-500 hover:text-white"
              >
                다음
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
