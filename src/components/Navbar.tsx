"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Film, Search, LogIn, LogOut, User, Globe } from "lucide-react";
import BaseUrlSettingsModal from "./BaseUrlSettingsModal";

interface CurrentUser {
  id: number;
  username: string;
  nickname: string;
  isAdmin: boolean;
}

export default function Navbar() {
  const [keyword, setKeyword] = useState("");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [domainStatus, setDomainStatus] = useState<"healthy" | "unhealthy" | "loading">("loading");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingAuth(false));

    fetch("/api/settings/base-url")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setDomainStatus(data.isHealthy ? "healthy" : "unhealthy");
        }
      })
      .catch(() => setDomainStatus("unhealthy"));
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (keyword.trim()) {
      router.push(`/?tab=search&q=${encodeURIComponent(keyword.trim())}`);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setCurrentUser(null);
      window.location.href = "/login";
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-purple-500/20 bg-[#0b0f19]/95 backdrop-blur-md safe-top">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 gap-3 safe-x">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-white shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-white shadow-lg shadow-purple-500/25">
            <Film className="h-5 w-5" />
          </div>
          <span className="hidden sm:inline bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 bg-clip-text text-transparent font-extrabold text-xl">
            Anihub
          </span>
        </Link>

        {/* Search Input */}
        <form onSubmit={handleSearch} className="relative flex-1 max-w-xs sm:max-w-sm mx-auto sm:mx-4">
          <input
            type="text"
            placeholder="애니 제목 검색..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-full rounded-full border border-purple-500/20 bg-slate-900/80 px-4 py-1.5 pl-9 text-xs sm:text-sm text-slate-200 placeholder-slate-400 outline-none transition focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
          <Search className="absolute left-3 top-2 sm:top-2.5 h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-400" />
        </form>

        {/* Right Auth & Settings Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Base URL Settings Button */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            title="스트리밍 도메인(베이스 URL) 설정"
            className="relative flex h-8 w-8 items-center justify-center rounded-full border border-purple-500/30 bg-slate-900/80 text-slate-300 hover:text-white hover:border-purple-500/60 hover:bg-slate-800 transition"
          >
            <Globe className="h-4 w-4" />
            <span
              className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0b0f19] ${
                domainStatus === "healthy"
                  ? "bg-emerald-400"
                  : domainStatus === "unhealthy"
                  ? "bg-rose-500 animate-pulse"
                  : "bg-slate-500"
              }`}
            />
          </button>

          {!isLoadingAuth && (
            <>
              {currentUser ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-slate-900/80 px-3 py-1 text-xs text-white">
                    <User className="h-3.5 w-3.5 text-purple-400" />
                    <span className="font-semibold">{currentUser.nickname}</span>
                    {currentUser.isAdmin && (
                      <span className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        관리자
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    title="로그아웃"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-slate-800/80 text-slate-400 transition hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-600/20 px-3.5 py-1.5 text-xs font-bold text-purple-300 transition hover:bg-purple-600 hover:text-white"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>로그인</span>
                </Link>
              )}
            </>
          )}
        </div>
      </div>

      <BaseUrlSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onUpdated={() => {
          setDomainStatus("healthy");
        }}
      />
    </header>
  );
}
