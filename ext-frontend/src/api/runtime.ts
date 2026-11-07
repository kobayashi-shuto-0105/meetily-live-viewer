const ACCESS_TOKEN_STORAGE_KEY = "meetily.externalWeb.accessToken";

export function getRuntimeAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const token = new URL(window.location.href).searchParams.get("token");
    if (token && token.length > 0) {
      window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
      return token;
    }

    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}
