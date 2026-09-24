import Navbar from "@/components/Navbar";
import Player from "@/components/Player";
import { getAnimeDetail, getEpisodeStream } from "@/lib/linkkf";
import { requireAuth } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";


export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; ep: string }>;
  searchParams: Promise<{ dub?: string }>;
}) {
  await requireAuth();

  const { id, ep } = await params;
  const { dub } = await searchParams;
  const epNum = parseInt(ep, 10) || 1;
  const isDub = dub === "1";

  const anime = await getAnimeDetail(id);
  if (!anime) {
    notFound();
  }

  const epList = isDub ? anime.dub_episodes : anime.sub_episodes;

  // 보안: 클라이언트에서 ?url= 로 임의 URL을 지정해 서버를 프록시/SSRF 수단으로 쓰는 것을 막기 위해
  // 스트림 URL은 항상 서버가 스크래핑한 회차 목록에서만 해석합니다.
  const matched = epList.find((e) => e.number === epNum) || epList[0];
  const watchUrl = matched?.watch_url || "";

  if (!watchUrl) {
    notFound();
  }

  const streamInfo = await getEpisodeStream(watchUrl);
  if (!streamInfo || !streamInfo.m3u8_url) {
    return (
      <div className="min-h-screen bg-[#0b0f19]">
        <Navbar />
        <main className="mx-auto max-w-4xl px-4 py-16 text-center">
          <div className="rounded-3xl border border-red-500/20 bg-slate-900/60 p-8">
            <h2 className="text-xl font-bold text-red-400">스트림 주소를 불러오지 못했습니다.</h2>
            <p className="mt-2 text-sm text-slate-400">
              해당 회차 영상 소스가 아직 업로드되지 않았거나 연결이 원활하지 않습니다.
            </p>
            <Link
              href={`/anime/${id}`}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white"
            >
              <ArrowLeft className="h-4 w-4" /> 작품 회차 목록으로 돌아가기
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const playerRef = streamInfo.player_url || "";
  const rawM3u8 = streamInfo.m3u8_url || "";
  const rawVtt = streamInfo.vtt_url || "";

  const proxiedM3u8 = rawM3u8
    ? `/api/anime/stream/m3u8?url=${encodeURIComponent(rawM3u8)}&ref=${encodeURIComponent(playerRef)}`
    : "";
  const proxiedVtt = rawVtt ? `/api/anime/stream/vtt?url=${encodeURIComponent(rawVtt)}` : "";

  let linkPreEpNum: number | null = null;
  let linkNextEpNum: number | null = null;
  let epTitle = `${epNum}화`;

  for (let idx = 0; idx < epList.length; idx++) {
    const e = epList[idx];
    if (e.number === epNum) {
      epTitle = e.title;
      if (idx > 0) {
        linkPreEpNum = epList[idx - 1].number;
      }
      if (idx + 1 < epList.length) {
        linkNextEpNum = epList[idx + 1].number;
      }
      break;
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0f19] pb-16">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Player Container (브레드크럼 헤더 및 무중단 동기화 내장) */}
        <Player
          animeId={id}
          animeTitle={anime.title}
          animePoster={anime.poster}
          episodeNumber={epNum}
          initialEpTitle={epTitle}
          m3u8Url={proxiedM3u8}
          defaultVttUrl={proxiedVtt}
          linkPreEp={linkPreEpNum}
          linkNextEp={linkNextEpNum}
          isDub={isDub}
          subEpisodes={anime.sub_episodes}
          dubEpisodes={anime.dub_episodes}
        />
      </main>
    </div>
  );
}
