import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const MAIN_JS = path.resolve("dist/main.js");
const FAKE_URL = "http://127.0.0.1:65535";

// Minimal valid recording content
const RECORDING_CONTENT = [
  "# version: 1",
  "# target_url: http://localhost:3838",
  "# target_type: R/Shiny",
  '{"type":"WS_OPEN","begin":"2020-01-01T00:00:00.000Z","url":"/websocket"}',
  '{"type":"WS_CLOSE","begin":"2020-01-01T00:00:01.000Z"}',
].join("\n");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [MAIN_JS, ...args],
      { timeout: 8000 },
      (error, stdout, stderr) => {
        const exitCode =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        resolve({ exitCode, stdout, stderr });
      },
    );
  });
}

let tempDir: string;
let recordingPath: string;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-test-"));
  recordingPath = path.join(tempDir, "recording.log");
  fs.writeFileSync(recordingPath, RECORDING_CONTENT, "utf-8");
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("CLI Process", () => {
  // CLI-01: --help
  it("--help exits 0 and shows usage", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Usage/i);
    expect(result.stdout).toContain("--workers");
    expect(result.stdout).toContain("--loaded-duration-minutes");
  }, 10000);

  // CLI-02: --version
  it("--version exits 0 and prints version", async () => {
    const result = await runCli(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  }, 10000);

  // CLI-02: -V (short form)
  it("-V exits 0 and prints version", async () => {
    const result = await runCli(["-V"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  }, 10000);

  // CLI-04: --workers 0
  it("--workers 0 exits non-zero with error", async () => {
    const result = await runCli([
      recordingPath,
      FAKE_URL,
      "--workers",
      "0",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("error");
  }, 10000);

  // CLI-04: --workers abc
  it("--workers abc exits non-zero with error", async () => {
    const result = await runCli([
      recordingPath,
      FAKE_URL,
      "--workers",
      "abc",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("error");
  }, 10000);

  // CLI-04: --workers 1.5
  it("--workers 1.5 exits non-zero with error", async () => {
    const result = await runCli([
      recordingPath,
      FAKE_URL,
      "--workers",
      "1.5",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("error");
  }, 10000);

  // CLI-16: non-existent recording file
  it("non-existent recording exits non-zero with 'not found'", async () => {
    const result = await runCli([
      path.join(tempDir, "does-not-exist.log"),
      FAKE_URL,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain("not found");
  }, 10000);

  // CLI-17: only 1 positional arg (no URL)
  it("missing app-url exits non-zero", async () => {
    const result = await runCli([recordingPath]);
    expect(result.exitCode).not.toBe(0);
  }, 10000);

  // CLI-18: no arguments at all
  it("no arguments exits non-zero", async () => {
    const result = await runCli([]);
    expect(result.exitCode).not.toBe(0);
  }, 10000);
});
