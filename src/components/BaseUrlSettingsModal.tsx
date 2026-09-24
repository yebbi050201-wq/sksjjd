"use client";

import React, { useState, useEffect } from "react";
import { Globe, RefreshCw, CheckCircle2, AlertTriangle, X, ShieldAlert, ExternalLink, ArrowRight } from "lucide-react";

interface BaseUrlSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: (newUrl: string) => void;
}

export default function BaseUrlSettingsModal({ isOpen, onClose, onUpdated }: BaseUrlSettingsModalProps) {
  const [currentUrl, setCurrentUrl] = useState<string>("https://linkkf.tv");
  const [defaultUrl, setDefaultUrl] = useState<string>("https://linkkf.tv");
  const [inputUrl, setInputUrl] = useState<string>("");
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const [loadingCheck, setLoadingCheck] = useState<boolean>(false);
  const [loadingSave, setLoadingSave] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState<boolean>(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  // 모달 열릴 때 현재 상태 조회
  const fetchStatus = async () => {
    setLoadingCheck(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/settings/base-url");
      const data = await res.json();
      if (data.success) {
        setCurrentUrl(data.baseUrl || "https://linkkf.tv");
        setDefaultUrl(data.defaultUrl || "https://linkkf.tv");
        setInputUrl(data.baseUrl || "https://linkkf.tv");
        setIsHealthy(Boolean(data.isHealthy));
        setLatencyMs(data.latencyMs ?? null);
        setStatusText(data.statusText || null);
      } else {
        setErrorMessage(data.message || "설정 정보를 불러오지 못했습니다.");
      }
    } catch {
      setErrorMessage("서버와 통신할 수 없습니다.");
    } finally {
      setLoadingCheck(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSuccessMessage(null);
      setNeedsConfirmation(false);
      setConfirmMessage(null);
      fetchStatus();
    }
  }, [isOpen]);

  const handleSave = async (force = false) => {
    if (!inputUrl.trim()) {
      setErrorMessage("URL을 입력해주세요.");
      return;
    }

    setLoadingSave(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!force) {
      setNeedsConfirmation(false);
      setConfirmMessage(null);
    }

    try {
      const res = await fetch("/api/settings/base-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: inputUrl.trim(), force }),
      });

      const data = await res.json();

      if (res.status === 422 && data.needsConfirmation) {
        setNeedsConfirmation(true);
        setConfirmMessage(data.message || "해당 도메인에 연결할 수 없습니다. 강제로 저장하시겠습니까?");
        setLoadingSave(false);
        return;
      }

      if (data.success) {
        setCurrentUrl(data.baseUrl);
        setIsHealthy(data.health ? data.health.ok : true);
        setLatencyMs(data.health ? data.health.latencyMs : null);
        setStatusText(data.health ? data.health.statusText : null);
        setSuccessMessage("베이스 URL이 성공적으로 변경되었습니다.");
        setNeedsConfirmation(false);
        setConfirmMessage(null);
        if (onUpdated) {
          onUpdated(data.baseUrl);
        }
      } else {
        setErrorMessage(data.message || "도메인 변경에 실패했습니다.");
      }
    } catch {
      setErrorMessage("서버 통신 중 오류가 발생했습니다.");
    } finally {
      setLoadingSave(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-purple-500/30 bg-[#0f1422] p-6 shadow-2xl shadow-purple-950/40">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-500/20 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/20 border border-purple-500/40 text-purple-400">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-white">스트리밍 도메인(베이스 URL) 설정</h3>
              <p className="text-xs text-slate-400">외부 애니 제공 사이트의 접속 도메인을 관리합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-5 space-y-4">
          {/* Current Status Box */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>현재 연결 상태</span>
              <button
                type="button"
                onClick={fetchStatus}
                disabled={loadingCheck}
                className="flex items-center gap-1 text-purple-400 hover:text-purple-300 disabled:opacity-50 transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingCheck ? "animate-spin" : ""}`} />
                <span>재확인</span>
              </button>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 font-mono text-sm text-slate-200">
                <span className="truncate max-w-[250px]">{currentUrl}</span>
                <a
                  href={currentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-purple-400 transition"
                  title="새 창에서 열기"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              <div>
                {loadingCheck ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">
                    <span className="h-2 w-2 rounded-full bg-slate-400 animate-pulse" />
                    확인 중...
                  </span>
                ) : isHealthy ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 text-xs font-medium text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    정상 연결 ({latencyMs}ms)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 border border-rose-500/30 px-2.5 py-1 text-xs font-medium text-rose-400">
                    <span className="h-2 w-2 rounded-full bg-rose-400 animate-ping" />
                    접속 불가 / 차단됨
                  </span>
                )}
              </div>
            </div>

            {statusText && (
              <p className="mt-2 text-[11px] text-slate-500 truncate">응답: {statusText}</p>
            )}
          </div>

          {/* Guide Alert */}
          <div className="flex items-start gap-2.5 rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3 text-xs text-indigo-300">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-indigo-400" />
            <p>
              인터넷 환경이나 통신사 DNS 차단으로 인해 기존 도메인 접속이 불가할 경우, 새롭게 우회된 최신 미러 도메인 주소를 입력하여 즉시 정상화할 수 있습니다.
            </p>
          </div>

          {/* Edit Form */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">새 베이스 URL 입력</label>
              {inputUrl !== defaultUrl && (
                <button
                  type="button"
                  onClick={() => setInputUrl(defaultUrl)}
                  className="text-[11px] text-purple-400 hover:text-purple-300 underline underline-offset-2"
                >
                  기본값({defaultUrl})으로 복원
                </button>
              )}
            </div>

            <div className="relative">
              <input
                type="text"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://linkkf.tv"
                className="w-full rounded-xl border border-purple-500/30 bg-slate-900/90 px-4 py-2.5 font-mono text-sm text-slate-200 placeholder-slate-500 outline-none transition focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Feedback Messages */}
          {errorMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Confirmation Warning if test failed */}
          {needsConfirmation && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-300 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p>{confirmMessage}</p>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  disabled={loadingSave}
                  className="rounded-lg bg-amber-600 hover:bg-amber-500 px-3 py-1.5 font-semibold text-white transition disabled:opacity-50"
                >
                  {loadingSave ? "저장 중..." : "확인하고 강제 적용"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-purple-500/20 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 transition"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={loadingSave || loadingCheck}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-600/30 hover:brightness-110 disabled:opacity-50 transition"
          >
            {loadingSave ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>연결 테스트 및 저장 중...</span>
              </>
            ) : (
              <>
                <span>연결 확인 및 변경 적용</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
