import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { auth } from "./firebase";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorData: any;
    const contentType = res.headers.get("content-type");

    try {
      if (contentType && contentType.includes("application/json")) {
        errorData = await res.json();
      } else {
        const text = await res.text();
        errorData = text || res.statusText;
      }
    } catch (e) {
      errorData = res.statusText || "Unknown error";
    }

    // Create a more detailed error with all available information
    let errorMessage = `${res.status}: `;
    if (errorData?.error) {
      errorMessage += errorData.error;
    } else if (errorData?.message) {
      errorMessage += errorData.message;
    } else if (typeof errorData === 'string') {
      errorMessage += errorData;
    } else {
      errorMessage += JSON.stringify(errorData);
    }

    const error = new Error(errorMessage);
    (error as any).status = res.status;
    (error as any).statusText = res.statusText;
    (error as any).data = errorData;
    (error as any).response = errorData; // Also store as response for compatibility
    throw error;
  }
}

/**
 * Get authentication headers with Firebase token
 * Automatically refreshes expired tokens
 */
async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    return {};
  }

  try {
    // Force refresh if requested, otherwise get token (will auto-refresh if expired)
    const token = forceRefresh
      ? await user.getIdToken(true)
      : await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  } catch (error) {
    console.error("Failed to get auth token:", error);
    // If token refresh fails, user might need to re-authenticate
    return {};
  }
}

/**
 * Retry request with fresh token if 401 occurs
 */
async function fetchWithAuthRetry(
  url: string,
  options: RequestInit = {},
  retries = 1
): Promise<Response> {
  let authHeaders = await getAuthHeaders();

  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...authHeaders,
    },
    credentials: "include",
  });

  // If 401 and we have retries left, try refreshing token and retry once
  if (res.status === 401 && retries > 0 && auth.currentUser) {
    console.log("Token expired, refreshing and retrying...");
    authHeaders = await getAuthHeaders(true); // Force refresh

    const retryRes = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        ...authHeaders,
      },
      credentials: "include",
    });

    return retryRes;
  }

  return res;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(data ? { "Content-Type": "application/json" } : {}),
  };

  const res = await fetchWithAuthRetry(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
    async ({ queryKey }) => {
      const url = queryKey.join("/") as string;

      const res = await fetchWithAuthRetry(url);

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
