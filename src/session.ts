/**
 * Session playback module. This is the core event loop that plays back
 * a recorded session against a live Shiny application.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CookieJar } from "tough-cookie";
import { VERSION } from "./version.js";
import {
  loginUrlFor,
  extractHiddenInputs,
  isProtected,
  loginRSC,
  loginSSP,
  getConnectCookies,
  connectApiKeyHeader,
} from "./auth.js";
import { detectServerType } from "./detect.js";
import {
  HttpClient,
  validateStatus,
  extractWorkerId,
  extractToken,
  getCookieString,
} from "./http.js";
import type { Logger } from "./logger.js";
import { SessionWriter } from "./output.js";
import { normalizeMessage, parseMessage } from "./sockjs.js";
import { replaceTokens, createTokenDictionary } from "./tokens.js";
import type {
  Recording,
  RecordingEvent,
  Creds,
} from "./types.js";
import { ALLOWED_TOKENS, ServerType, hasUserPass, hasConnectApiKey } from "./types.js";
import { joinPaths, httpToWs } from "./url.js";
import { ShinyWebSocket } from "./websocket.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_AGENT = `shinycannon/${VERSION}`;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export class Stats {
  private running = 0;
  private done = 0;
  private failed = 0;

  transition(t: "running" | "done" | "failed"): void {
    switch (t) {
      case "running":
        this.running++;
        break;
      case "done":
        this.done++;
        this.running--;
        break;
      case "failed":
        this.failed++;
        this.running--;
        break;
    }
  }

  getCounts(): { running: number; done: number; failed: number } {
    return {
      running: this.running,
      done: this.done,
      failed: this.failed,
    };
  }

  /** Record a failure without decrementing running (for pre-start failures). */
  recordFailure(): void {
    this.failed++;
  }

  toString(): string {
    return `Running: ${this.running}, Failed: ${this.failed}, Done: ${this.done}`;
  }
}

// ---------------------------------------------------------------------------
// SessionConfig
// ---------------------------------------------------------------------------

export interface SessionConfig {
  sessionId: number;
  workerId: number;
  iterationId: number;
  httpUrl: string;
  recording: Recording;
  recordingPath: string;
  headers: Record<string, string>;
  creds: Creds;
  logger: Logger;
  outputDir: string;
  argsString: string;
  argsJson: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowMs(): number {
  return Date.now();
}

function sleepBefore(
  event: RecordingEvent,
  lastEventEnded: number | null,
  wsOpen: boolean,
): number {
  switch (event.type) {
    case "WS_SEND":
    case "WS_CLOSE":
      return event.begin - (lastEventEnded ?? event.begin);
    case "REQ_GET":
      return wsOpen
        ? event.begin - (lastEventEnded ?? event.begin)
        : 0;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

async function maybeLogin(
  httpClient: HttpClient,
  httpUrl: string,
  creds: Creds,
  headers: Record<string, string>,
  logger: Logger,
): Promise<Record<string, string>> {
  // Connect API Key takes precedence
  if (hasConnectApiKey(creds)) {
    await getConnectCookies(httpClient, httpUrl);
    return { ...headers, ...connectApiKeyHeader(creds.connectApiKey!) };
  }

  if (hasUserPass(creds)) {
    const appProtected = await isProtected(httpClient, httpUrl);
    if (appProtected) {
      const serverType = await detectServerType(httpUrl, httpClient);
      const loginUrl = loginUrlFor(httpUrl, serverType);

      if (serverType === ServerType.RSC) {
        await loginRSC(httpClient, loginUrl, creds.user!, creds.pass!);
      } else {
        // SSP: need to fetch login page for hidden inputs
        const loginPageResp = await httpClient.get(loginUrl);
        const hiddenInputs = extractHiddenInputs(loginPageResp.body);
        await loginSSP(
          httpClient,
          loginUrl,
          creds.user!,
          creds.pass!,
          hiddenInputs,
        );
      }
    } else {
      logger.info(
        "SHINYCANNON_USER and SHINYCANNON_PASS set, but target app doesn't require authentication.",
      );
    }
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

interface SessionState {
  httpClient: HttpClient;
  httpUrl: string;
  tokenDictionary: Map<string, string>;
  commIdMapping: Map<string, string>;
  recordingPath: string;
  logger: Logger;
  webSocket: ShinyWebSocket | null;
  failure: Error | null;
  headers: Record<string, string>;
  creds: Creds;
}

function replaceSessionTokens(
  s: string,
  tokenDictionary: ReadonlyMap<string, string>,
): string {
  return replaceTokens(s, ALLOWED_TOKENS, tokenDictionary);
}

async function handleReqHome(
  event: RecordingEvent & { type: "REQ_HOME" },
  state: SessionState,
): Promise<void> {
  const renderedUrl = replaceSessionTokens(event.url, state.tokenDictionary);
  const url = joinPaths(state.httpUrl, renderedUrl);
  const resp = await state.httpClient.get(url);
  validateStatus(event.status, resp.statusCode, url, resp.body);

  const workerId = extractWorkerId(resp.body);
  if (workerId !== null) {
    state.tokenDictionary.set("WORKER", workerId);
  }
}

async function handleReqSinf(
  event: RecordingEvent & { type: "REQ_SINF" },
  state: SessionState,
): Promise<void> {
  const renderedUrl = replaceSessionTokens(event.url, state.tokenDictionary);
  const url = joinPaths(state.httpUrl, renderedUrl);
  const resp = await state.httpClient.get(url);
  validateStatus(event.status, resp.statusCode, url, resp.body);
}

async function handleReqTok(
  event: RecordingEvent & { type: "REQ_TOK" },
  state: SessionState,
): Promise<void> {
  const renderedUrl = replaceSessionTokens(event.url, state.tokenDictionary);
  const url = joinPaths(state.httpUrl, renderedUrl);
  const resp = await state.httpClient.get(url);
  validateStatus(event.status, resp.statusCode, url, resp.body);
  state.tokenDictionary.set("TOKEN", extractToken(resp.body));
}

async function handleReqGet(
  event: RecordingEvent & { type: "REQ_GET" },
  state: SessionState,
): Promise<void> {
  const renderedUrl = replaceSessionTokens(event.url, state.tokenDictionary);
  const url = joinPaths(state.httpUrl, renderedUrl);
  const resp = await state.httpClient.get(url);
  validateStatus(event.status, resp.statusCode, url, resp.body);
}

async function handleReqPost(
  event: RecordingEvent & { type: "REQ_POST" },
  state: SessionState,
): Promise<void> {
  const renderedUrl = replaceSessionTokens(event.url, state.tokenDictionary);
  const url = joinPaths(state.httpUrl, renderedUrl);

  let body: string | Buffer | undefined;
  let contentType: string | undefined;

  if (event.datafile !== undefined) {
    const parentDir = path.dirname(state.recordingPath);
    const filePath = path.resolve(parentDir, event.datafile);
    const realParent = fs.realpathSync(path.resolve(parentDir));
    let realFile: string;
    try {
      realFile = fs.realpathSync(filePath);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Datafile not found: ${event.datafile}`);
      }
      throw err;
    }
    if (!realFile.startsWith(realParent + path.sep) && realFile !== realParent) {
      throw new Error(`Datafile path escapes recording directory: ${event.datafile}`);
    }
    body = fs.readFileSync(realFile);
    contentType = "application/octet-stream";
  }

  const resp = await state.httpClient.post(url, body, contentType);
  validateStatus(event.status, resp.statusCode, url, resp.body);
}

async function handleWsOpen(
  event: RecordingEvent & { type: "WS_OPEN" },
  state: SessionState,
): Promise<void> {
  if (state.webSocket !== null) {
    throw new Error("Tried to WS_OPEN but already have a websocket");
  }

  const wsBaseUrl = httpToWs(state.httpUrl);
  const renderedUrl = replaceSessionTokens(event.url, state.tokenDictionary);
  const wsUrl = joinPaths(wsBaseUrl, renderedUrl);

  const cookieString = await getCookieString(
    state.httpClient.cookieJar,
    state.httpUrl,
  );

  const wsHeaders: Record<string, string> = {
    ...state.headers,
    "user-agent": USER_AGENT,
  };
  if (cookieString) {
    wsHeaders["cookie"] = cookieString;
  }

  const ws = new ShinyWebSocket({
    url: wsUrl,
    headers: wsHeaders,
    onIgnored: (msg) => {
      state.logger.debug(`Ignoring: ${msg}`);
    },
  });

  ws.onFailure((error) => {
    state.failure = error;
  });

  state.webSocket = ws;
}

/** @internal Exported for testing. */
export function extractCommId(commOpenJson: string): string | null {
  try {
    const obj = JSON.parse(commOpenJson) as Record<string, unknown>;
    const content = obj["content"] as Record<string, unknown> | undefined;
    return typeof content?.["comm_id"] === "string" ? content["comm_id"] : null;
  } catch {
    return null;
  }
}

function extractCommIdMapping(
  expectingObj: Record<string, unknown>,
  receivedObj: Record<string, unknown> | null,
  state: SessionState,
): void {
  const expectingCustom = expectingObj["custom"] as Record<string, unknown> | undefined;
  const receivedCustom = receivedObj?.["custom"] as Record<string, unknown> | undefined;
  if (expectingCustom == null || receivedCustom == null) return;

  const commOpenKey = "shinywidgets_comm_open";
  if (!(commOpenKey in expectingCustom) || !(commOpenKey in receivedCustom)) return;

  const recordedCommId = extractCommId(expectingCustom[commOpenKey] as string);
  const actualCommId = extractCommId(receivedCustom[commOpenKey] as string);
  if (recordedCommId != null && actualCommId != null) {
    state.commIdMapping.set(recordedCommId, actualCommId);
    state.logger.debug(`Mapped comm_id: ${recordedCommId} -> ${actualCommId}`);
  }
}

/** @internal Exported for testing. */
export function replaceCommIds(s: string, commIdMapping: ReadonlyMap<string, string>): string {
  let result = s;
  for (const [recorded, actual] of commIdMapping) {
    result = result.replaceAll(recorded, actual);
  }
  return result;
}

function handleWsSend(
  event: RecordingEvent & { type: "WS_SEND" },
  state: SessionState,
): void {
  if (state.webSocket === null) {
    throw new Error("Tried to WS_SEND but no websocket is open");
  }
  const tokenReplaced = replaceSessionTokens(event.message, state.tokenDictionary);
  const text = replaceCommIds(tokenReplaced, state.commIdMapping);
  state.webSocket.send(text);
  state.logger.debug(`WS_SEND sent: ${text}`);
}

async function handleWsRecv(
  event: RecordingEvent & { type: "WS_RECV" },
  state: SessionState,
): Promise<void> {
  if (state.webSocket === null) {
    throw new Error("Tried to WS_RECV but no websocket is open");
  }

  const receivedStr = await state.webSocket.receive((elapsed) => {
    state.logger.warn(
      `WS_RECV line ${event.lineNumber}: Haven't received message after ${elapsed} seconds`,
    );
  });
  state.logger.debug(`WS_RECV received: ${receivedStr}`);

  const expectingStr = replaceSessionTokens(event.message, state.tokenDictionary);
  const expectingObj = parseMessage(expectingStr);

  if (expectingObj === null) {
    // String comparison (e.g. the "o" open frame)
    if (expectingStr !== receivedStr) {
      throw new Error(
        `Expected string ${expectingStr} but got ${receivedStr}`,
      );
    }
  } else {
    const receivedNormalized = normalizeMessage(receivedStr);
    const receivedObj = parseMessage(receivedNormalized);
    const expectingKeys = Object.keys(expectingObj).sort().join(",");
    const receivedKeys = receivedObj
      ? Object.keys(receivedObj).sort().join(",")
      : "";
    if (expectingKeys !== receivedKeys) {
      throw new Error(
        `Objects don't have same keys: expected [${expectingKeys}], got [${receivedKeys}]`,
      );
    }

    // Extract comm_id mapping from shinywidgets_comm_open messages
    extractCommIdMapping(expectingObj, receivedObj, state);
  }
}

async function handleWsRecvInit(
  event: RecordingEvent & { type: "WS_RECV_INIT" },
  state: SessionState,
): Promise<void> {
  if (state.webSocket === null) {
    throw new Error("Tried to WS_RECV_INIT but no websocket is open");
  }

  const receivedStr = await state.webSocket.receive((elapsed) => {
    state.logger.warn(
      `WS_RECV_INIT line ${event.lineNumber}: Haven't received message after ${elapsed} seconds`,
    );
  });
  state.logger.debug(`WS_RECV_INIT received: ${receivedStr}`);

  const parsed = parseMessage(receivedStr);
  const sessionId = (
    parsed?.["config"] as Record<string, unknown> | undefined
  )?.["sessionId"];

  if (typeof sessionId !== "string") {
    throw new Error(
      `Expected sessionId from WS_RECV_INIT message. Message: ${receivedStr}`,
    );
  }

  state.tokenDictionary.set("SESSION", sessionId);
  state.logger.debug(`WS_RECV_INIT got SESSION: ${sessionId}`);
}

async function handleWsRecvBeginUpload(
  event: RecordingEvent & { type: "WS_RECV_BEGIN_UPLOAD" },
  state: SessionState,
): Promise<void> {
  if (state.webSocket === null) {
    throw new Error(
      "Tried to WS_RECV_BEGIN_UPLOAD but no websocket is open",
    );
  }

  const receivedStr = await state.webSocket.receive((elapsed) => {
    state.logger.warn(
      `WS_RECV_BEGIN_UPLOAD line ${event.lineNumber}: Haven't received message after ${elapsed} seconds`,
    );
  });
  state.logger.debug(`WS_RECV_BEGIN_UPLOAD received: ${receivedStr}`);

  const parsed = parseMessage(receivedStr);
  const response = parsed?.["response"] as
    | Record<string, unknown>
    | undefined;
  const value = response?.["value"] as Record<string, unknown> | undefined;
  const jobId = value?.["jobId"];

  if (typeof jobId !== "string") {
    throw new Error("Expected jobId from WS_RECV_BEGIN_UPLOAD message");
  }

  state.tokenDictionary.set("UPLOAD_JOB_ID", jobId);
  state.logger.debug(`WS_RECV_BEGIN_UPLOAD got jobId: ${jobId}`);
}

function handleWsClose(
  _event: RecordingEvent & { type: "WS_CLOSE" },
  state: SessionState,
): void {
  if (state.webSocket === null) {
    throw new Error("Tried to WS_CLOSE but no websocket is open");
  }
  state.webSocket.close();
  state.logger.debug("WS_CLOSE sent");
  state.webSocket = null;
}

async function handleEvent(
  event: RecordingEvent,
  state: SessionState,
): Promise<void> {
  switch (event.type) {
    case "REQ_HOME":
      return handleReqHome(event, state);
    case "REQ_SINF":
      return handleReqSinf(event, state);
    case "REQ_TOK":
      return handleReqTok(event, state);
    case "REQ_GET":
      return handleReqGet(event, state);
    case "REQ_POST":
      return handleReqPost(event, state);
    case "WS_OPEN":
      return handleWsOpen(event, state);
    case "WS_SEND":
      handleWsSend(event, state);
      return;
    case "WS_RECV":
      return handleWsRecv(event, state);
    case "WS_RECV_INIT":
      return handleWsRecvInit(event, state);
    case "WS_RECV_BEGIN_UPLOAD":
      return handleWsRecvBeginUpload(event, state);
    case "WS_CLOSE":
      handleWsClose(event, state);
      return;
  }
}

// ---------------------------------------------------------------------------
// runSession
// ---------------------------------------------------------------------------

export async function runSession(
  config: SessionConfig,
  stats: Stats,
  startDelayMs?: number,
): Promise<void> {
  const {
    sessionId,
    workerId,
    iterationId,
    httpUrl,
    recording,
    recordingPath,
    creds,
    logger,
    outputDir,
    argsString,
    argsJson,
  } = config;

  const cookieJar = new CookieJar();
  const tokenDictionary = createTokenDictionary();

  // Merge Connect API key header if applicable
  let headers = { ...config.headers };

  const httpClient = new HttpClient({
    cookieJar,
    headers,
    userAgent: USER_AGENT,
  });

  const writer = new SessionWriter({
    outputDir,
    sessionId,
    workerId,
    iterationId,
    argsString,
    argsJson,
  });

  const state: SessionState = {
    httpClient,
    httpUrl,
    tokenDictionary,
    commIdMapping: new Map(),
    recordingPath,
    logger,
    webSocket: null,
    failure: null,
    headers,
    creds,
  };

  let started = false;

  try {
    writer.writeCsv(
      sessionId,
      workerId,
      iterationId,
      "PLAYER_SESSION_CREATE",
      nowMs(),
      0,
      "",
    );

    // Login if needed
    headers = await maybeLogin(httpClient, httpUrl, creds, headers, logger);
    state.headers = headers;
    httpClient.setHeaders(headers);

    // Start delay
    if (startDelayMs !== undefined && startDelayMs > 0) {
      writer.writeCsv(
        sessionId,
        workerId,
        iterationId,
        "PLAYBACK_START_INTERVAL_START",
        nowMs(),
        0,
        "",
      );
      await sleep(startDelayMs);
      writer.writeCsv(
        sessionId,
        workerId,
        iterationId,
        "PLAYBACK_START_INTERVAL_END",
        nowMs(),
        0,
        "",
      );
    }

    stats.transition("running");
    started = true;

    let lastEventEnded: number | null = null;

    for (const event of recording.events) {
      const sleepFor = sleepBefore(
        event,
        lastEventEnded,
        state.webSocket !== null,
      );

      if (sleepFor > 0) {
        writer.writeCsv(
          sessionId,
          workerId,
          iterationId,
          "PLAYBACK_SLEEPBEFORE_START",
          nowMs(),
          event.lineNumber,
          "",
        );
        await sleep(sleepFor);
        writer.writeCsv(
          sessionId,
          workerId,
          iterationId,
          "PLAYBACK_SLEEPBEFORE_END",
          nowMs(),
          event.lineNumber,
          "",
        );
      }

      // Check for async failure (e.g. WebSocket error during sleep)
      if (state.failure !== null) {
        throw state.failure;
      }

      // Handle the event with START/END logging
      writer.writeCsv(
        sessionId,
        workerId,
        iterationId,
        `${event.type}_START`,
        nowMs(),
        event.lineNumber,
        "",
      );

      await handleEvent(event, state);

      writer.writeCsv(
        sessionId,
        workerId,
        iterationId,
        `${event.type}_END`,
        nowMs(),
        event.lineNumber,
        "",
      );

      lastEventEnded = event.begin;

      // Check for async failure after event handling
      if (state.failure !== null) {
        throw state.failure;
      }
    }

    stats.transition("done");
    writer.writeCsv(
      sessionId,
      workerId,
      iterationId,
      "PLAYBACK_DONE",
      nowMs(),
      0,
      "",
    );
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (started) {
      stats.transition("failed");
    } else {
      // Failed before entering "running" state — record failure without
      // decrementing the running counter.
      stats.recordFailure();
    }
    writer.writeCsv(
      sessionId,
      workerId,
      iterationId,
      "PLAYBACK_FAIL",
      nowMs(),
      0,
      "",
    );
    logger.error(`Playback failed: ${error.message}`, error);
  } finally {
    if (state.webSocket !== null) {
      try { state.webSocket.close(); } catch { /* ignore close errors */ }
      state.webSocket = null;
    }
    writer.close();
  }
}
