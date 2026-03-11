// Core type definitions for shinyloadtest.
// Types only — no implementation logic beyond simple helpers.

// ---------------------------------------------------------------------------
// Server Type
// ---------------------------------------------------------------------------

export enum ServerType {
  RSC = "RSC",
  SSP = "SSP",
  SAI = "SAI",
  SHN = "SHN",
  UNK = "UNK",
}

export const SERVER_TYPE_NAMES: ReadonlyMap<ServerType, string> = new Map([
  [ServerType.RSC, "RStudio Server Connect"],
  [ServerType.SSP, "Shiny Server or Shiny Server Pro"],
  [ServerType.SAI, "shinyapps.io"],
  [ServerType.SHN, "R/Shiny"],
  [ServerType.UNK, "Unknown"],
])

const NAME_TO_SERVER_TYPE: ReadonlyMap<string, ServerType> = new Map(
  [...SERVER_TYPE_NAMES.entries()].map(([k, v]) => [v, k]),
)

export function serverTypeFromName(name: string): ServerType {
  const type = NAME_TO_SERVER_TYPE.get(name)
  if (type === undefined) {
    throw new Error(`Unknown server type name in recording: ${name}`)
  }
  return type
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RECORDING_VERSION = 1
export const RECEIVE_QUEUE_SIZE = 50

export const ALLOWED_TOKENS = new Set([
  "WORKER",
  "TOKEN",
  "ROBUST_ID",
  "SOCKJSID",
  "SESSION",
  "UPLOAD_URL",
  "UPLOAD_JOB_ID",
])

// ---------------------------------------------------------------------------
// Recording Events (discriminated union)
// ---------------------------------------------------------------------------

interface EventBase {
  readonly begin: number
  readonly lineNumber: number
}

interface HttpEventBase extends EventBase {
  readonly url: string
  readonly status: number
}

interface WsMessageEventBase extends EventBase {
  readonly message: string
}

export interface ReqHome extends HttpEventBase {
  readonly type: "REQ_HOME"
}

export interface ReqSinf extends HttpEventBase {
  readonly type: "REQ_SINF"
}

export interface ReqTok extends HttpEventBase {
  readonly type: "REQ_TOK"
}

export interface ReqGet extends HttpEventBase {
  readonly type: "REQ_GET"
}

export interface ReqPost extends HttpEventBase {
  readonly type: "REQ_POST"
  readonly datafile: string | undefined
}

export interface WsOpen extends EventBase {
  readonly type: "WS_OPEN"
  readonly url: string
}

export interface WsSend extends WsMessageEventBase {
  readonly type: "WS_SEND"
}

export interface WsRecv extends WsMessageEventBase {
  readonly type: "WS_RECV"
}

export interface WsRecvInit extends WsMessageEventBase {
  readonly type: "WS_RECV_INIT"
}

export interface WsRecvBeginUpload extends WsMessageEventBase {
  readonly type: "WS_RECV_BEGIN_UPLOAD"
}

export interface WsClose extends EventBase {
  readonly type: "WS_CLOSE"
}

export type HttpEvent = ReqHome | ReqSinf | ReqTok | ReqGet | ReqPost

export type WsEvent =
  | WsOpen
  | WsSend
  | WsRecv
  | WsRecvInit
  | WsRecvBeginUpload
  | WsClose

export type RecordingEvent = HttpEvent | WsEvent

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

const HTTP_TYPES = new Set<string>([
  "REQ_HOME",
  "REQ_SINF",
  "REQ_TOK",
  "REQ_GET",
  "REQ_POST",
])

const WS_TYPES = new Set<string>([
  "WS_OPEN",
  "WS_SEND",
  "WS_RECV",
  "WS_RECV_INIT",
  "WS_RECV_BEGIN_UPLOAD",
  "WS_CLOSE",
])

export function isHttpEvent(event: RecordingEvent): event is HttpEvent {
  return HTTP_TYPES.has(event.type)
}

export function isWsEvent(event: RecordingEvent): event is WsEvent {
  return WS_TYPES.has(event.type)
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface RecordingProps {
  readonly version: number
  readonly targetUrl: string
  readonly targetType: ServerType
  readonly rscApiKeyRequired: boolean
}

export interface Recording {
  readonly props: RecordingProps
  readonly events: readonly RecordingEvent[]
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface Creds {
  readonly user: string | null
  readonly pass: string | null
  readonly connectApiKey: string | null
}

export function hasUserPass(creds: Creds): boolean {
  return creds.user !== null && creds.pass !== null
}

export function hasConnectApiKey(creds: Creds): boolean {
  return creds.connectApiKey !== null
}
