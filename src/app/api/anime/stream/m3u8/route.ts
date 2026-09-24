import { NextRequest, NextResponse } from "next/server";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 프록시로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url")?.trim();
  let refUrl = searchParams.get("ref")?.trim();
  if (!refUrl) {
    try {
      refUrl = targetUrl ? new URL(targetUrl).origin + "/" : "https://playv2.sub3.top/";
    } catch {
      refUrl = "https://playv2.sub3.top/";
    }
  }

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  try {
    await assertSafeProxyUrl(targetUrl);
  } catch (e) {
    if (e instanceof UnsafeProxyUrlError) {
      return new NextResponse(`Blocked URL: ${e.message}`, { status: 400 });
    }
    throw e;
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: refUrl,
      },
    });

    if (!res.ok) {
      return new NextResponse(`Upstream error: ${res.statusText}`, { status: res.status });
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const newLines: string[] = [];

    for (const line of lines) {
      const stripped = line.trim();
      if (stripped && !stripped.startsWith("#")) {
        const absUrl = new URL(stripped, targetUrl).toString();
        if (absUrl.includes(".m3u8")) {
          newLines.push(
            `/api/anime/stream/m3u8?url=${encodeURIComponent(absUrl)}&ref=${encodeURIComponent(refUrl)}`
          );
        } else {
          newLines.push(absUrl);
        }
      } else {
        newLines.push(line);
      }
    }

    return new NextResponse(newLines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, s-maxage=86400, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[Proxy m3u8 error]:", error);
    // 보안: 내부/외부 에러 상세를 응답 본문에 노출하지 않음
    return new NextResponse("Proxy error", {
      status: 502,
    });
  }
}
