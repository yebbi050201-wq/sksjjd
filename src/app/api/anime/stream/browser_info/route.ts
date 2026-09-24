import { NextRequest, NextResponse } from "next/server";
import { getAnimeDetail, getEpisodeStream } from "@/lib/linkkf";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const animeId = searchParams.get("anime_id")?.trim();
  const ep = parseInt(searchParams.get("ep") || "1", 10) || 1;
  const isDub = searchParams.get("dub") === "1";

  if (!animeId) {
    return NextResponse.json({ success: false, message: "Missing anime_id" }, { status: 400 });
  }

  try {
    const detail = await getAnimeDetail(animeId);
    if (!detail) {
      return NextResponse.json({ success: false, message: "Anime not found" }, { status: 404 });
    }

    const epList = isDub && detail.dub_episodes?.length ? detail.dub_episodes : detail.sub_episodes;
    const targetEp = epList.find((e) => e.number === ep) || epList[0];
    if (!targetEp?.watch_url) {
      return NextResponse.json({ success: false, message: "Episode not found" }, { status: 404 });
    }

    // Do not probe the CDN here. The purpose of this endpoint is to let the
    // browser try the media URL directly when the Vercel egress gets a 403.
    const streamInfo = await getEpisodeStream(targetEp.watch_url, true, false);
    if (!streamInfo?.m3u8_url) {
      return NextResponse.json({ success: false, message: "m3u8 URL not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      m3u8_url: streamInfo.m3u8_url,
      player_url: streamInfo.player_url,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[browser_stream_info error]:", error);
    return NextResponse.json({ success: false, message: "Stream information unavailable" }, { status: 502 });
  }
}
