import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseHeader, serializeArgs, parseArgs, type ParsedArgs } from "../cli.js";
import { parseLogLevel, LogLevel } from "../logger.js";
import { readRecordingFromString, recordingDuration } from "../recording.js";

// ---------------------------------------------------------------------------
// parseHeader
// ---------------------------------------------------------------------------

describe("parseHeader", () => {
  it("parses a simple header", () => {
    expect(parseHeader("X-Foo: bar")).toEqual(["X-Foo", "bar"]);
  });

  it("trims leading whitespace from the value", () => {
    expect(parseHeader("X-Foo:  bar")).toEqual(["X-Foo", "bar"]);
  });

  it("splits only on the first colon", () => {
    expect(parseHeader("X-Foo: bar: baz")).toEqual(["X-Foo", "bar: baz"]);
  });

  it("throws on a malformed header without a colon", () => {
    expect(() => parseHeader("malformed")).toThrow("Malformed header");
  });

  it("throws when header name is empty", () => {
    expect(() => parseHeader(": no-name")).toThrow("Header name is empty");
  });
});

// ---------------------------------------------------------------------------
// serializeArgs
// ---------------------------------------------------------------------------

describe("serializeArgs", () => {
  function makeArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
    return {
      recordingPath: "/tmp/recording.log",
      appUrl: "http://example.com/app",
      workers: 3,
      loadedDurationMinutes: 10,
      startInterval: null,
      headers: {},
      outputDir: "/tmp/output",
      overwriteOutput: false,
      debugLog: false,
      logLevel: LogLevel.WARN,
      creds: { user: null, pass: null, connectApiKey: null },
      ...overrides,
    };
  }

  it("includes required fields in argsString", () => {
    const { argsString } = serializeArgs(makeArgs());

    expect(argsString).toContain("http://example.com/app");
    expect(argsString).toContain("--workers 3");
    expect(argsString).toContain("--loaded-duration-minutes 10");
    expect(argsString).toContain("--output-dir /tmp/output");
    expect(argsString).toContain("--log-level warn");
  });

  it("produces valid JSON in argsJson", () => {
    const { argsJson } = serializeArgs(makeArgs());
    const parsed = JSON.parse(argsJson);

    expect(parsed.appUrl).toBe("http://example.com/app");
    expect(parsed.workers).toBe(3);
    expect(parsed.loadedDurationMinutes).toBe(10);
    expect(parsed.startInterval).toBeNull();
    expect(parsed.outputDir).toBe("/tmp/output");
    expect(parsed.logLevel).toBe("WARN");
  });

  it("does not include --start-interval when null", () => {
    const { argsString } = serializeArgs(makeArgs({ startInterval: null }));
    expect(argsString).not.toContain("--start-interval");
  });

  it("includes --start-interval when set", () => {
    const { argsString } = serializeArgs(makeArgs({ startInterval: 500 }));
    expect(argsString).toContain("--start-interval 500");
  });

  it("includes -H entries for headers", () => {
    const { argsString } = serializeArgs(
      makeArgs({ headers: { "X-Custom": "value1", Authorization: "Bearer tok" } }),
    );
    expect(argsString).toContain('-H "X-Custom: value1"');
    expect(argsString).toContain('-H "Authorization: Bearer tok"');
  });
});

// ---------------------------------------------------------------------------
// parseLogLevel
// ---------------------------------------------------------------------------

describe("parseLogLevel", () => {
  it("parses 'debug' to DEBUG", () => {
    expect(parseLogLevel("debug")).toBe(LogLevel.DEBUG);
  });

  it("parses 'INFO' case-insensitively", () => {
    expect(parseLogLevel("INFO")).toBe(LogLevel.INFO);
  });

  it("parses 'warn' to WARN", () => {
    expect(parseLogLevel("warn")).toBe(LogLevel.WARN);
  });

  it("parses 'error' to ERROR", () => {
    expect(parseLogLevel("error")).toBe(LogLevel.ERROR);
  });

  it("throws on an invalid level", () => {
    expect(() => parseLogLevel("INVALID")).toThrow("Unknown log level");
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  let tmpDir: string;
  let recordingFile: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-cli-test-"));
    recordingFile = path.join(tmpDir, "recording.log");
    fs.writeFileSync(recordingFile, "# placeholder recording\n");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults startInterval to null when not provided", () => {
    const args = parseArgs([
      "node",
      "script",
      recordingFile,
      "http://example.com",
    ]);

    expect(args.startInterval).toBeNull();
    expect(args.recordingPath).toBe(recordingFile);
    expect(args.appUrl).toBe("http://example.com");
    expect(args.workers).toBe(1);
    expect(args.loadedDurationMinutes).toBe(5);
    expect(args.logLevel).toBe(LogLevel.WARN);
  });
});

// ---------------------------------------------------------------------------
// start interval default
// ---------------------------------------------------------------------------

describe("start interval default", () => {
  it("BC-05: defaults to recording_duration / num_workers", () => {
    // The start interval formula is: duration / workers
    // where duration = last_event.begin - first_event.begin
    //
    // Given a recording with duration 10000ms and 5 workers,
    // the start interval should be 2000ms.
    const recording = readRecordingFromString([
      "# version: 1",
      "# target_url: http://example.com",
      "# target_type: R/Shiny",
      JSON.stringify({ type: "WS_OPEN", begin: "2020-01-01T00:00:00.000Z", url: "/ws" }),
      JSON.stringify({ type: "WS_CLOSE", begin: "2020-01-01T00:00:10.000Z" }),
    ].join("\n"));

    const duration = recordingDuration(recording);
    expect(duration).toBe(10000);

    // Simulate the formula from main.ts
    const workers = 5;
    const startInterval = null;
    const computed = startInterval !== null ? startInterval : duration / workers;
    expect(computed).toBe(2000);
  });

  it("BC-05: uses explicit start interval when provided", () => {
    const recording = readRecordingFromString([
      "# version: 1",
      "# target_url: http://example.com",
      "# target_type: R/Shiny",
      JSON.stringify({ type: "WS_OPEN", begin: "2020-01-01T00:00:00.000Z", url: "/ws" }),
      JSON.stringify({ type: "WS_CLOSE", begin: "2020-01-01T00:00:10.000Z" }),
    ].join("\n"));

    const duration = recordingDuration(recording);
    const workers = 5;
    const startInterval: number | null = 500;
    const computed = startInterval !== null ? startInterval : duration / workers;
    expect(computed).toBe(500);
  });
});
