import { NextRequest, NextResponse } from "next/server";
import { searchAllSubtitlesParallel, findKairanSubtitle, fetchCreatorSubtitle } from "@/lib/subtitles";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 크롤링/퍼치 서비스로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title")?.trim();
  const ep = parseInt(searchParams.get("ep") || "1", 10) || 1;

  if (!title) {
    return NextResponse.json(
      { success: false, message: "Missing anime title parameter" },
      { status: 400 }
    );
  }

  try {
    // 13초 타임아웃 방어 가드 적용
    const result = await searchAllSubtitlesParallel(title, ep, 13000);

    // HTML 등 비정상 자막 필터링
    const validSubtitles = (result.subtitles || []).filter((s) => {
      if (!s.content) return false;
      const lower = s.content.slice(0, 300).toLowerCase();
      if (lower.includes("<!doctype html") || lower.includes("<html") || lower.includes("<head>")) {
        return false;
      }
      return true;
    });

    return NextResponse.json(
      {
        success: true,
        anime_title: title,
        episode: ep,
        count: validSubtitles.length,
        subtitles: validSubtitles,
        creators: result.creators,
      },
      {
        status: 200,
        headers: {
          // 자막이 실제로 있을 때만 Vercel Edge CDN에 24시간 캐싱
          // (검색 타임아웃 등으로 빈 결과가 24시간 캐시되면 재방문 시 자막 검색이 영구 실패함)
          "Cache-Control":
            validSubtitles.length > 0
              ? "public, s-maxage=86400, stale-while-revalidate=43200"
              : "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("[Subtitles API error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "자막 검색에 실패했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 크롤링/퍼치 서비스로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const { creatorName, website, title, episodeNumber } = body;
    const ep = parseInt(String(episodeNumber || "1"), 10) || 1;

    if (!creatorName || !title) {
      return NextResponse.json(
        { success: false, message: "필수 정보가 누락되었습니다." },
        { status: 400 }
      );
    }

    // 보안: website는 서버에서 fetch하므로 SSRF 가드 통과 필수
    if (website) {
      try {
        await assertSafeProxyUrl(String(website));
      } catch (e) {
        if (e instanceof UnsafeProxyUrlError) {
          return NextResponse.json(
            { success: false, message: `허용되지 않는 주소입니다: ${e.message}` },
            { status: 400 }
          );
        }
        throw e;
      }
    }

    let sub = null;
    if (creatorName.includes("카이란") || (website && website.toLowerCase().includes("kairan"))) {
      sub = await findKairanSubtitle(title, ep, 5000);
    } else if (website) {
      sub = await fetchCreatorSubtitle(creatorName, website, title, ep, 5000);
    }

    if (!sub || !sub.content) {
      return NextResponse.json({
        success: false,
        message: "해당 제작자 블로그에서 자막을 자동으로 추출하지 못했습니다.",
      });
    }

    // HTML 응답 필터링
    const lower = sub.content.slice(0, 300).toLowerCase();
    if (lower.includes("<!doctype html") || lower.includes("<html") || lower.includes("<head>")) {
      return NextResponse.json({
        success: false,
        message: "유효하지 않은 자막 파일 형식입니다.",
      });
    }

    return NextResponse.json({
      success: true,
      subtitle: sub,
    });
  } catch (error) {
    console.error("[Subtitles POST error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "자막 추출 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

