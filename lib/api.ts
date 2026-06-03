"use client";

const BASE = process.env.NEXT_PUBLIC_API_URL || "";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("skyvult_access");
}
function getRefresh() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("skyvult_refresh");
}

export function setTokens(access: string, refresh?: string) {
  localStorage.setItem("skyvult_access", access);
  if (refresh) localStorage.setItem("skyvult_refresh", refresh);
}

export function clearTokens() {
  localStorage.removeItem("skyvult_access");
  localStorage.removeItem("skyvult_refresh");
}

async function refreshAccess(): Promise<string | null> {
  const r = getRefresh();
  if (!r) return null;
  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: r }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const data = await res.json();
  setTokens(data.accessToken);
  return data.accessToken;
}

export async function api<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const doFetch = async (token: string | null) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as any),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    // `cache: "no-store"` defeats iOS Safari's aggressive GET caching, which
    // otherwise keeps serving stale /api/wallet, /api/auth/me, /api/trades/open
    // responses for minutes — that's why the same account could read 0 balance
    // on the phone while the PC sees the correct value.
    return fetch(`${BASE}${path}`, { ...init, headers, cache: "no-store" });
  };

  let token = getToken();
  let res = await doFetch(token);
  if (res.status === 401 && getRefresh()) {
    token = await refreshAccess();
    if (token) res = await doFetch(token);
  }
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === "string" ? body : body?.error || "Request failed";
    throw new Error(msg);
  }
  return body as T;
}
