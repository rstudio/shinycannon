/**
 * HTTP client wrapper with tough-cookie integration for per-session
 * cookie management. Provides the HTTP operations needed during
 * session playback.
 */

import { CookieJar } from "tough-cookie";

// ---------------------------------------------------------------------------
// HttpResponse
// ---------------------------------------------------------------------------

export interface HttpResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Check status equality with the 200/304 equivalence rule:
 * 200 and 304 are treated as interchangeable.
 */
export function statusEquals(expected: number, actual: number): boolean {
  if (expected === actual) return true;
  if (expected === 200 && actual === 304) return true;
  if (expected === 304 && actual === 200) return true;
  return false;
}

/**
 * Throw a descriptive error if the actual status does not match the expected
 * status (using the 200/304 equivalence rule).
 */
export function validateStatus(
  expected: number,
  actual: number,
  url: string,
  body: string,
): void {
  if (statusEquals(expected, actual)) return;

  const preview = body.length > 200 ? body.substring(0, 200) + "..." : body;
  throw new Error(
    `Status ${actual} received, expected ${expected}, URL: ${url}\n${preview}`,
  );
}

/**
 * Extract the worker ID from a Shiny app's HTML response.
 * Looks for `<base href="_w_<id>/">` in the HTML.
 */
export function extractWorkerId(html: string): string | null {
  const re = /<base\s+href="_w_([0-9a-z]+)\/">/;
  const match = re.exec(html);
  return match?.[1] ?? null;
}

/**
 * Extract a token from a response body. The body IS the token (trimmed).
 */
export function extractToken(body: string): string {
  return body.trim();
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Get the cookie string for a URL from the jar.
 * Exported for WebSocket use (setting Cookie header on upgrade).
 */
export async function getCookieString(
  jar: CookieJar,
  url: string,
): Promise<string> {
  return jar.getCookieString(url);
}

// ---------------------------------------------------------------------------
// HttpClient
// ---------------------------------------------------------------------------

export class HttpClient {
  readonly cookieJar: CookieJar;
  private customHeaders: Record<string, string>;
  private readonly userAgent: string;

  constructor(options: {
    cookieJar: CookieJar;
    headers: Record<string, string>;
    userAgent: string;
  }) {
    this.cookieJar = options.cookieJar;
    this.customHeaders = options.headers;
    this.userAgent = options.userAgent;
  }

  setHeaders(headers: Record<string, string>): void {
    this.customHeaders = headers;
  }

  async get(url: string, signal?: AbortSignal): Promise<HttpResponse> {
    return this.request(url, { method: "GET", signal });
  }

  async post(
    url: string,
    body?: string | Buffer,
    contentType?: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = {};
    if (contentType) {
      headers["content-type"] = contentType;
    }
    return this.request(url, {
      method: "POST",
      headers,
      body: body ?? null,
      signal,
    });
  }

  async postForm(
    url: string,
    fields: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<HttpResponse> {
    const encoded = new URLSearchParams(fields).toString();
    return this.post(url, encoded, "application/x-www-form-urlencoded", signal);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async request(
    url: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: string | Buffer | null;
      signal?: AbortSignal;
    },
  ): Promise<HttpResponse> {
    const cookieString = await this.cookieJar.getCookieString(url);

    const headers: Record<string, string> = {
      "user-agent": this.userAgent,
      ...this.customHeaders,
      ...init.headers,
    };

    if (cookieString) {
      headers["cookie"] = cookieString;
    }

    const response = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      redirect: "follow",
      signal: init.signal,
    });

    // Store cookies from response
    const setCookieHeaders = response.headers.getSetCookie();
    for (const setCookie of setCookieHeaders) {
      await this.cookieJar.setCookie(setCookie, url);
    }

    // Build lowercased headers map
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    const body = await response.text();

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
    };
  }
}
