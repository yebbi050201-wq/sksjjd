import Link from "next/link";
import { AnimeListItem } from "@/lib/linkkf";
import { PlayCircle } from "lucide-react";

export default function AnimeCard({ anime }: { anime: AnimeListItem }) {
  const targetHref = anime.id
    ? `/anime/${anime.id}`
    : anime.detail_url && !anime.detail_url.startsWith("http")
    ? anime.detail_url
    : "/";

  return (
    <Link
      href={targetHref}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#10182c]/80 transition duration-200 hover:-translate-y-1.5 hover:border-purple-500/50 hover:shadow-xl hover:shadow-purple-900/30 text-decoration-none"
    >
      {/* 16:9 Landscape Poster Wrapper (가로로 긴 와이드 비율) */}
      <div className="relative aspect-video w-full overflow-hidden bg-slate-950">
        {anime.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={anime.poster}
            alt={anime.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            style={{ objectPosition: "center 25%" }}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
            No Image
          </div>
        )}

        {/* 랭킹 뱃지 (좌측 상단) */}
        {anime.rank ? (
          <span
            className={`absolute top-2 left-2 flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-extrabold shadow-md z-10 ${
              anime.rank === 1
                ? "bg-gradient-to-r from-amber-400 to-amber-600 text-black shadow-amber-500/50"
                : anime.rank === 2
                ? "bg-gradient-to-r from-slate-200 to-slate-400 text-black shadow-slate-400/40"
                : anime.rank === 3
                ? "bg-gradient-to-r from-orange-300 to-orange-600 text-black shadow-orange-500/40"
                : "bg-black/75 text-purple-400 border border-purple-500/40 backdrop-blur-md"
            }`}
          >
            {anime.rank}위
          </span>
        ) : anime.remarks ? (
          <span className="absolute top-2 right-2 rounded-lg bg-black/75 px-2 py-0.5 text-xs font-bold text-purple-400 border border-purple-500/40 backdrop-blur-md z-10">
            {anime.remarks}
          </span>
        ) : null}
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col justify-between p-3">
        <h3
          className="line-clamp-2 text-sm font-bold text-slate-100 transition group-hover:text-purple-300 leading-snug"
          title={anime.title}
        >
          {anime.title}
        </h3>
        <div className="mt-2 flex items-center text-xs text-slate-400 transition group-hover:text-purple-400">
          <PlayCircle className="h-3.5 w-3.5 text-purple-500 mr-1" />
          <span>보러가기</span>
        </div>
      </div>
    </Link>
  );
}
