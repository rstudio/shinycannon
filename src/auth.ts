/**
 * Authentication flows for different Shiny server types.
 * Handles login for RSC (RStudio Connect), SSP (Shiny Server Pro),
 * and Connect API key authentication.
 */

import { type HttpClient } from "./http.js";
import { type Creds, ServerType } from "./types.js";

// ---------------------------------------------------------------------------
// Login URL
// ---------------------------------------------------------------------------

export function loginUrlFor(appUrl: string, serverType: ServerType): string {
  if (serverType !== ServerType.RSC && serverType !== ServerType.SSP) {
    throw new Error(
      `Don't know how to construct login URL for server type: ${serverType}`,
    );
  }
  const url = new URL(appUrl);
  url.pathname = url.pathname.replace(/\/?$/, "/__login__");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Hidden input extraction
// ---------------------------------------------------------------------------

export function extractHiddenInputs(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  const inputRegex = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  const nameRegex = /name=["']([^"']*)["']/i;
  const valueRegex = /value=["']([^"']*)["']/i;

  let match: RegExpExecArray | null;
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0]!;
    const nameMatch = nameRegex.exec(tag);
    const valueMatch = valueRegex.exec(tag);
    if (nameMatch?.[1] !== undefined) {
      result[nameMatch[1]] = valueMatch?.[1] ?? "";
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Protected check
// ---------------------------------------------------------------------------

export async function isProtected(
  httpClient: HttpClient,
  appUrl: string,
): Promise<boolean> {
  const resp = await httpClient.get(appUrl);
  return resp.statusCode === 403 || resp.statusCode === 404;
}

// ---------------------------------------------------------------------------
// Login flows
// ---------------------------------------------------------------------------

export async function loginRSC(
  httpClient: HttpClient,
  loginUrl: string,
  username: string,
  password: string,
): Promise<void> {
  const body = JSON.stringify({ username, password });
  const resp = await httpClient.post(loginUrl, body, "application/json");
  if (resp.statusCode !== 200 && resp.statusCode !== 302) {
    throw new Error(
      `RSC login failed with status ${resp.statusCode}: ${resp.body}`,
    );
  }
}

export async function loginSSP(
  httpClient: HttpClient,
  loginUrl: string,
  username: string,
  password: string,
  hiddenInputs: Record<string, string>,
): Promise<void> {
  const fields: Record<string, string> = {
    username,
    password,
    ...hiddenInputs,
  };
  const resp = await httpClient.postForm(loginUrl, fields);
  if (resp.statusCode !== 200 && resp.statusCode !== 302) {
    throw new Error(
      `SSP login failed with status ${resp.statusCode}: ${resp.body}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Connect cookies / API key
// ---------------------------------------------------------------------------

export async function getConnectCookies(
  httpClient: HttpClient,
  appUrl: string,
): Promise<void> {
  await httpClient.get(appUrl);
}

export function connectApiKeyHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Key ${apiKey}` };
}

// ---------------------------------------------------------------------------
// Credentials from environment
// ---------------------------------------------------------------------------

export function getCreds(): Creds {
  const connectApiKey = process.env["SHINYCANNON_CONNECT_API_KEY"] || null;

  if (connectApiKey !== null) {
    return {
      user: null,
      pass: null,
      connectApiKey,
    };
  }

  const user = process.env["SHINYCANNON_USER"] || null;
  const pass = process.env["SHINYCANNON_PASS"] || null;

  return { user, pass, connectApiKey: null };
}
