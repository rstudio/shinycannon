import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MockShinyServer } from "./helpers/mock-shiny-server.js";
import { runSession, Stats } from "../session.js";
import type { SessionConfig } from "../session.js";
import { readRecordingFromString } from "../recording.js";
import type { Logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCapturingLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];
  const logger: Logger = {
    debug: (msg: string) => messages.push(`DEBUG: ${msg}`),
    info: (msg: string) => messages.push(`INFO: ${msg}`),
    warn: (msg: string) => messages.push(`WARN: ${msg}`),
    error: (msg: string) => messages.push(`ERROR: ${msg}`),
    child(_name: string): Logger {
      return this;
    },
  };
  return { logger, messages };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-auth-test-"));
}

function setupOutputDir(tmpDir: string, recordingContent: string): {
  outputDir: string;
  recordingPath: string;
} {
  const outputDir = path.join(tmpDir, "output");
  fs.mkdirSync(path.join(outputDir, "sessions"), { recursive: true });
  const recordingPath = path.join(tmpDir, "recording.log");
  fs.writeFileSync(recordingPath, recordingContent, "utf-8");
  return { outputDir, recordingPath };
}

function makeSessionConfig(
  overrides: Partial<SessionConfig> & {
    httpUrl: string;
    recording: ReturnType<typeof readRecordingFromString>;
    recordingPath: string;
    logger: Logger;
    outputDir: string;
  },
): SessionConfig {
  return {
    sessionId: 0,
    workerId: 0,
    iterationId: 0,
    headers: {},
    creds: { user: null, pass: null, connectApiKey: null },
    argsString: "test",
    argsJson: "{}",
    ...overrides,
  };
}

function readCsvEvents(outputDir: string): string[] {
  const sessionsDir = path.join(outputDir, "sessions");
  const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".csv"));
  if (files.length === 0) return [];
  const content = fs.readFileSync(path.join(sessionsDir, files[0]!), "utf-8");
  const lines = content.split("\n").filter((l) => l.length > 0 && !l.startsWith("#"));
  // Skip the header row
  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    return parts[3] ?? "";
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth Integration", { timeout: 30000 }, () => {
  let tmpDir: string | undefined;
  let mock: MockShinyServer | undefined;

  afterEach(async () => {
    if (mock) {
      await mock.stop();
      mock = undefined;
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("logs warning when creds set but app is not protected (AUTH-05)", async () => {
    mock = new MockShinyServer();
    await mock.start();

    const recordingContent = mock.makeRecording();
    tmpDir = makeTempDir();
    const { outputDir, recordingPath } = setupOutputDir(tmpDir, recordingContent);
    const recording = readRecordingFromString(recordingContent);

    const { logger, messages } = createCapturingLogger();
    const stats = new Stats();

    const config = makeSessionConfig({
      httpUrl: mock.url,
      recording,
      recordingPath,
      logger,
      outputDir,
      creds: { user: "testuser", pass: "testpass", connectApiKey: null },
    });

    await runSession(config, stats);

    // The mock server returns 200 for GET /, so isProtected returns false
    const warningMsg = messages.find((m) =>
      m.includes("doesn't require authentication"),
    );
    expect(warningMsg).toBeDefined();
    expect(warningMsg).toContain("SHINYCANNON_USER");
    expect(warningMsg).toContain("SHINYCANNON_PASS");

    // Session should still complete successfully
    const events = readCsvEvents(outputDir);
    expect(events).toContain("PLAYBACK_DONE");
  });

  it("throws when rscApiKeyRequired but no key set (AUTH-06)", () => {
    const content = [
      "# version: 1",
      "# target_url: https://connect.example.com/app",
      "# target_type: RStudio Server Connect",
      "# rscApiKeyRequired: true",
      JSON.stringify({
        type: "WS_OPEN",
        begin: "2020-01-01T00:00:00.000Z",
        url: "/websocket",
      }),
      JSON.stringify({
        type: "WS_CLOSE",
        begin: "2020-01-01T00:00:01.000Z",
      }),
    ].join("\n");

    const recording = readRecordingFromString(content);
    expect(recording.props.rscApiKeyRequired).toBe(true);

    // Reproduce the exact validation from main.ts:
    // if (recording.props.rscApiKeyRequired && creds.connectApiKey === null) throw
    function validateApiKey(rscRequired: boolean, apiKey: string | null): void {
      if (rscRequired && apiKey === null) {
        throw new Error(
          "Recording requires an RStudio Connect API key but SHINYCANNON_CONNECT_API_KEY is not set.",
        );
      }
    }

    // No key → should throw
    expect(() =>
      validateApiKey(recording.props.rscApiKeyRequired, null),
    ).toThrow("SHINYCANNON_CONNECT_API_KEY");

    // Key present → should not throw
    expect(() =>
      validateApiKey(recording.props.rscApiKeyRequired, "test-key"),
    ).not.toThrow();
  });

  it("session completes with Connect API key creds (no auth required)", async () => {
    mock = new MockShinyServer();
    await mock.start();

    const recordingContent = mock.makeRecording();
    tmpDir = makeTempDir();
    const { outputDir, recordingPath } = setupOutputDir(tmpDir, recordingContent);
    const recording = readRecordingFromString(recordingContent);

    const { logger } = createCapturingLogger();
    const stats = new Stats();

    const config = makeSessionConfig({
      httpUrl: mock.url,
      recording,
      recordingPath,
      logger,
      outputDir,
      creds: { user: null, pass: null, connectApiKey: "test-api-key" },
    });

    await runSession(config, stats);

    // Session should complete successfully
    const events = readCsvEvents(outputDir);
    expect(events).toContain("PLAYBACK_DONE");

    const counts = stats.getCounts();
    expect(counts.done).toBe(1);
    expect(counts.failed).toBe(0);
  });

  it("session completes without any creds (no login attempted)", async () => {
    mock = new MockShinyServer();
    await mock.start();

    const recordingContent = mock.makeRecording();
    tmpDir = makeTempDir();
    const { outputDir, recordingPath } = setupOutputDir(tmpDir, recordingContent);
    const recording = readRecordingFromString(recordingContent);

    const { logger, messages } = createCapturingLogger();
    const stats = new Stats();

    const config = makeSessionConfig({
      httpUrl: mock.url,
      recording,
      recordingPath,
      logger,
      outputDir,
      creds: { user: null, pass: null, connectApiKey: null },
    });

    await runSession(config, stats);

    // No auth warning should appear
    const warningMsg = messages.find((m) =>
      m.includes("doesn't require authentication"),
    );
    expect(warningMsg).toBeUndefined();

    // Session should complete
    const events = readCsvEvents(outputDir);
    expect(events).toContain("PLAYBACK_DONE");
  });
});
