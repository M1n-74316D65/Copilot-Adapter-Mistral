export const DEFAULT_BROWSER_AUTH_BASE_URL = `https://console.mistral.ai`;
export const DEFAULT_BROWSER_AUTH_API_BASE_URL = `https://console.mistral.ai/api`;

export const POLL_INTERVAL_MS = 3000;
export const MAX_CONSECUTIVE_POLL_FAILURES = 3;
/** Backoff base for transient poll failures; grows 1.5s, 3s, … and is capped. */
export const POLL_BACKOFF_BASE_MS = 1500;
export const POLL_BACKOFF_MAX_MS = 10_000;
/** Allow for client/server clock skew when judging expiry. */
export const CLOCK_SKEW_TOLERANCE_MS = 5000;
export const HTTP_FORBIDDEN = 403;
export const HTTP_GONE = 410;
export const HTTP_TOO_MANY_REQUESTS = 429;
/** API error code returned when the workspace may not create API keys for Mistral Vibe. */
export const API_KEYS_CREATE_UNAUTHORIZED_ERROR_CODE = 9004;
export const WORKSPACE_NOT_ELIGIBLE_MESSAGE = `Your current workspace can't be used for Mistral Vibe. Sign in again and select another workspace in the browser, or contact your administrator.`;

/**
 * Mirrors vibe's check for HTTP 403 + body `error_code == 9004` on the
 * sign-in exchange endpoint. The body is consumed defensively; a missing or
 * malformed body just means "not this error".
 */
export async function isWorkspaceApiKeyCreationDenied (response: Response): Promise<boolean> {
    try {
        const payload = (await response.clone().json()) as { error_code?: unknown };
        return payload?.error_code === API_KEYS_CREATE_UNAUTHORIZED_ERROR_CODE;
    } catch {
        return false;
    }
}
