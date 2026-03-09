import * as fs from "node:fs";
import {
  RECORDING_VERSION,
  serverTypeFromName,
  type Recording,
  type RecordingEvent,
  type RecordingProps,
} from "./types.js";

// ---------------------------------------------------------------------------
// Property parsing
// ---------------------------------------------------------------------------

const PROP_RE = /^# (\w+): (.*)$/;

function readPropLine(line: string): [string, string] {
  const match = PROP_RE.exec(line);
  if (!match) {
    throw new Error(`Invalid property line: ${line}`);
  }
  return [match[1]!, match[2]!];
}

function readProps(lines: readonly string[]): RecordingProps {
  const raw = new Map<string, string>();
  for (const line of lines) {
    if (!line.startsWith("#")) break;
    const [key, value] = readPropLine(line);
    raw.set(key, value);
  }

  // Legacy format upgrade
  if (raw.has("target") && !raw.has("version")) {
    raw.set("target_url", raw.get("target")!);
    raw.delete("target");
    raw.set("version", RECORDING_VERSION.toString());
    raw.set("target_type", "Unknown");
  }

  // Validate required properties
  for (const key of ["version", "target_url", "target_type"]) {
    if (!raw.has(key)) {
      throw new Error(`Recording is missing required property: ${key}`);
    }
  }

  const versionStr = raw.get("version")!;
  if (!/^\d+$/.test(versionStr)) {
    throw new Error(`Invalid recording version: ${versionStr}`);
  }
  const version = Number(versionStr);
  if (version < 0) {
    throw new Error(`Invalid recording version: ${raw.get("version")}`);
  }
  if (version > RECORDING_VERSION) {
    throw new Error(
      `Recording version ${version} is newer than supported version ${RECORDING_VERSION}`,
    );
  }

  const rscApiKeyRequired = raw.get("rscApiKeyRequired") === "true";

  return {
    version,
    targetUrl: raw.get("target_url")!,
    targetType: serverTypeFromName(raw.get("target_type")!),
    rscApiKeyRequired,
  };
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

function parseEvent(lineNumber: number, line: string): RecordingEvent {
  const obj = JSON.parse(line) as Record<string, unknown>;
  const begin = new Date(obj["begin"] as string).getTime();
  const type = obj["type"] as string;

  switch (type) {
    case "REQ_HOME":
    case "REQ_SINF":
    case "REQ_TOK":
    case "REQ_GET":
      return {
        type,
        begin,
        lineNumber,
        url: obj["url"] as string,
        status: obj["status"] as number,
      };
    case "REQ_POST":
      return {
        type,
        begin,
        lineNumber,
        url: obj["url"] as string,
        status: obj["status"] as number,
        datafile: (obj["datafile"] as string | undefined) ?? undefined,
      };
    case "WS_OPEN":
      return {
        type,
        begin,
        lineNumber,
        url: obj["url"] as string,
      };
    case "WS_SEND":
    case "WS_RECV":
    case "WS_RECV_INIT":
    case "WS_RECV_BEGIN_UPLOAD":
      return {
        type,
        begin,
        lineNumber,
        message: obj["message"] as string,
      };
    case "WS_CLOSE":
      return {
        type,
        begin,
        lineNumber,
      };
    default:
      throw new Error(`Unknown event type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readRecordingFromString(content: string): Recording {
  const allLines = content.split("\n");
  const nonEmptyLines = allLines.filter((l) => l.length > 0);

  const props = readProps(nonEmptyLines);

  const events: RecordingEvent[] = [];
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i]!;
    if (line.length === 0 || line.startsWith("#")) continue;
    events.push(parseEvent(i + 1, line));
  }

  if (events.length === 0) {
    throw new Error("Recording contains no events");
  }

  const lastEvent = events[events.length - 1]!;
  if (lastEvent.type !== "WS_CLOSE") {
    throw new Error(
      `Recording must end with WS_CLOSE, but ends with ${lastEvent.type}`,
    );
  }

  return { props, events };
}

export function readRecording(filePath: string): Recording {
  const content = fs.readFileSync(filePath, "utf-8");
  return readRecordingFromString(content);
}

export function recordingDuration(recording: Recording): number {
  const events = recording.events;
  if (events.length === 0) return 0;
  return events[events.length - 1]!.begin - events[0]!.begin;
}
