import { describe, it, expect } from "vitest";
import { readRecordingFromString, recordingDuration } from "../recording.js";

// Helper to build a minimal valid recording string
function makeRecording(
  headers: string[],
  events: Record<string, unknown>[],
): string {
  const headerLines = headers.join("\n");
  const eventLines = events.map((e) => JSON.stringify(e)).join("\n");
  return `${headerLines}\n${eventLines}`;
}

const DEFAULT_HEADERS = [
  "# version: 1",
  "# target_url: http://localhost:3838",
  "# target_type: R/Shiny",
];

const T0 = "2020-01-01T00:00:00.000Z";
const T1 = "2020-01-01T00:00:01.000Z";
const T2 = "2020-01-01T00:00:02.000Z";
const T3 = "2020-01-01T00:00:03.000Z";
const T4 = "2020-01-01T00:00:04.000Z";
const T5 = "2020-01-01T00:00:05.000Z";

describe("readRecordingFromString", () => {
  it("parses a valid recording with all event types", () => {
    const events = [
      { type: "REQ_HOME", begin: T0, url: "/", status: 200 },
      { type: "REQ_SINF", begin: T0, url: "/__sinf__", status: 200 },
      { type: "REQ_TOK", begin: T0, url: "/__token__", status: 200 },
      { type: "REQ_GET", begin: T1, url: "/shared/resource.js", status: 200 },
      {
        type: "REQ_POST",
        begin: T1,
        url: "/upload",
        status: 200,
        datafile: "data.csv",
      },
      { type: "WS_OPEN", begin: T2, url: "/websocket" },
      { type: "WS_RECV_INIT", begin: T2, message: '{"config":{}}' },
      { type: "WS_SEND", begin: T3, message: '{"method":"init"}' },
      { type: "WS_RECV", begin: T3, message: '{"values":{}}' },
      {
        type: "WS_RECV_BEGIN_UPLOAD",
        begin: T4,
        message: '{"uploadUrl":"abc"}',
      },
      { type: "WS_CLOSE", begin: T5 },
    ];

    const recording = readRecordingFromString(
      makeRecording(DEFAULT_HEADERS, events),
    );

    expect(recording.props.version).toBe(1);
    expect(recording.props.targetUrl).toBe("http://localhost:3838");
    expect(recording.props.targetType).toBe("SHN");
    expect(recording.props.rscApiKeyRequired).toBe(false);
    expect(recording.events).toHaveLength(11);

    // Verify specific event types
    expect(recording.events[0]!.type).toBe("REQ_HOME");
    expect(recording.events[4]!.type).toBe("REQ_POST");
    const post = recording.events[4]!;
    if (post.type === "REQ_POST") {
      expect(post.datafile).toBe("data.csv");
    }
    expect(recording.events[5]!.type).toBe("WS_OPEN");
    expect(recording.events[10]!.type).toBe("WS_CLOSE");

    // Verify begin is parsed to epoch ms
    expect(recording.events[0]!.begin).toBe(new Date(T0).getTime());

    // Verify lineNumber is 1-based (3 header lines + 1st event = line 4)
    expect(recording.events[0]!.lineNumber).toBe(4);
  });

  it("upgrades legacy format with only 'target' property", () => {
    const headers = ["# target: http://legacy-app:3838"];
    const events = [
      { type: "WS_OPEN", begin: T0, url: "/ws" },
      { type: "WS_CLOSE", begin: T1 },
    ];

    const recording = readRecordingFromString(makeRecording(headers, events));

    expect(recording.props.version).toBe(1);
    expect(recording.props.targetUrl).toBe("http://legacy-app:3838");
    expect(recording.props.targetType).toBe("UNK");
  });

  it("throws on missing required property", () => {
    const headers = ["# version: 1", "# target_url: http://localhost:3838"];
    const events = [{ type: "WS_CLOSE", begin: T0 }];

    expect(() =>
      readRecordingFromString(makeRecording(headers, events)),
    ).toThrow("missing required property: target_type");
  });

  it("throws when recording version is too high", () => {
    const headers = [
      "# version: 999",
      "# target_url: http://localhost:3838",
      "# target_type: R/Shiny",
    ];
    const events = [{ type: "WS_CLOSE", begin: T0 }];

    expect(() =>
      readRecordingFromString(makeRecording(headers, events)),
    ).toThrow("newer than supported version");
  });

  it("throws when last event is not WS_CLOSE", () => {
    const events = [
      { type: "WS_OPEN", begin: T0, url: "/ws" },
      { type: "WS_SEND", begin: T1, message: "hello" },
    ];

    expect(() =>
      readRecordingFromString(makeRecording(DEFAULT_HEADERS, events)),
    ).toThrow("must end with WS_CLOSE");
  });

  it("throws when there are no events", () => {
    const content = DEFAULT_HEADERS.join("\n");

    expect(() => readRecordingFromString(content)).toThrow(
      "Recording contains no events",
    );
  });

  it("parses rscApiKeyRequired as true", () => {
    const headers = [
      "# version: 1",
      "# target_url: https://connect.example.com/app",
      "# target_type: RStudio Server Connect",
      "# rscApiKeyRequired: true",
    ];
    const events = [{ type: "WS_CLOSE", begin: T0 }];

    const recording = readRecordingFromString(makeRecording(headers, events));
    expect(recording.props.rscApiKeyRequired).toBe(true);
    expect(recording.props.targetType).toBe("RSC");
  });

  it("defaults rscApiKeyRequired to false when not present", () => {
    const events = [{ type: "WS_CLOSE", begin: T0 }];

    const recording = readRecordingFromString(
      makeRecording(DEFAULT_HEADERS, events),
    );
    expect(recording.props.rscApiKeyRequired).toBe(false);
  });
});

describe("recordingDuration", () => {
  it("returns the difference between first and last event begin times", () => {
    const events = [
      { type: "WS_OPEN", begin: T0, url: "/ws" },
      { type: "WS_SEND", begin: T3, message: "hello" },
      { type: "WS_CLOSE", begin: T5 },
    ];

    const recording = readRecordingFromString(
      makeRecording(DEFAULT_HEADERS, events),
    );
    // T5 - T0 = 5000ms
    expect(recordingDuration(recording)).toBe(5000);
  });
});
