const rawBaseUrl = process.env.NEXT_PUBLIC_API_HOST?.trim() ?? "";
const normalizedBaseUrl = rawBaseUrl.replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function resolveBaseUrl(): string | null {
  if (normalizedBaseUrl) {
    return normalizedBaseUrl;
  }
  // Fallback para mesma origem em ambientes onde a env não foi fornecida.
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return null;
}

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const base = resolveBaseUrl();
  if (!base) {
    throw new Error(
      "API host não configurado. Defina NEXT_PUBLIC_API_HOST em .env.local ou acesse via mesma origem."
    );
  }
  if (!path.startsWith("/")) {
    return `${base}/${path}`;
  }
  return `${base}${path}`;
}

function handleNotFoundSideEffects(path: string) {
  if (typeof window === "undefined") return;
  if (path.includes("/companies/")) {
    try {
      window.localStorage.removeItem("fluitax:selected-company");
      window.dispatchEvent(new CustomEvent("fluitax:company-not-found"));
    } catch {
      // ignore storage issues
    }
  }
}

export async function fetchJson<T>(
  path: string,
  init?: RequestInit & { onNotFound?: () => void }
): Promise<T> {
  const response = await fetch(buildUrl(path), {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new ApiError(`Failed to parse API response: ${String(error)}`, response.status, text);
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      handleNotFoundSideEffects(path);
      if (typeof init?.onNotFound === "function") {
        init.onNotFound();
      }
    }

    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "Request failed")
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export function getApiBaseUrl(): string {
  return resolveBaseUrl() ?? "";
}
