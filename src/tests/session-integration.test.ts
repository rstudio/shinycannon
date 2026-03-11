import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { MockShinyServer } from "./helpers/mock-shiny-server.js"
import { runSession, Stats, extractCommId, replaceCommIds } from "../session.js"
import type { SessionConfig } from "../session.js"
import { readRecordingFromString } from "../recording.js"
import { createLogger, LogLevel } from "../logger.js"
import { createOutputDir } from "../output.js"

let mock: MockShinyServer
let tmpDir: string
let recordingPath: string
let outputDir: string

beforeAll(async () => {
  mock = new MockShinyServer()
  await mock.start()

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-integ-"))
  recordingPath = path.join(tmpDir, "recording.log")
  fs.writeFileSync(recordingPath, mock.makeRecording())
  outputDir = path.join(tmpDir, "output")

  createOutputDir({
    outputDir,
    overwrite: false,
    version: "0.0.0-test",
    recordingPath,
  })
})

afterAll(async () => {
  await mock.stop()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

let sessionCounter = 0

async function runTestSession(
  overrides?: Partial<SessionConfig>,
): Promise<string[]> {
  const id = sessionCounter++
  const recording = readRecordingFromString(
    fs.readFileSync(recordingPath, "utf-8"),
  )
  const stats = new Stats()
  const logger = createLogger({ name: "test", consoleLevel: LogLevel.ERROR })

  const config: SessionConfig = {
    sessionId: id,
    workerId: 0,
    iterationId: 0,
    httpUrl: mock.url,
    recording,
    recordingPath,
    headers: {},
    creds: { user: null, pass: null, connectApiKey: null },
    logger,
    outputDir,
    argsString: "test-args",
    argsJson: '{"test":true}',
    ...overrides,
  }

  await runSession(config, stats)

  const csvPath = path.join(
    outputDir,
    "sessions",
    `${config.sessionId}_${config.workerId}_${config.iterationId}.csv`,
  )
  return fs
    .readFileSync(csvPath, "utf-8")
    .split("\n")
    .filter((l) => l.length > 0)
}

describe("Session Integration", { timeout: 30000 }, () => {
  it("PLAY-01: single worker completes a session with correct event sequence", async () => {
    const lines = await runTestSession()
    const dataLines = lines.slice(3)
    const events = dataLines.map((l) => l.split(",")[3])

    // Filter out sleep events to check the core sequence
    const coreEvents = events.filter(
      (e) => !e?.startsWith("PLAYBACK_SLEEPBEFORE_"),
    )

    expect(coreEvents).toEqual([
      "PLAYER_SESSION_CREATE",
      "REQ_HOME_START",
      "REQ_HOME_END",
      "REQ_SINF_START",
      "REQ_SINF_END",
      "REQ_TOK_START",
      "REQ_TOK_END",
      "WS_OPEN_START",
      "WS_OPEN_END",
      "WS_RECV_INIT_START",
      "WS_RECV_INIT_END",
      "WS_SEND_START",
      "WS_SEND_END",
      "WS_RECV_START",
      "WS_RECV_END",
      "WS_CLOSE_START",
      "WS_CLOSE_END",
      "PLAYBACK_DONE",
    ])
  })

  it("PLAY-03: CSV column names match spec", async () => {
    const lines = await runTestSession()
    expect(lines[2]).toBe(
      "session_id,worker_id,iteration,event,timestamp,input_line_number,comment",
    )
  })

  it("PLAY-04: CSV comment lines contain args", async () => {
    const lines = await runTestSession()
    expect(lines[0]).toBe("# test-args")
    expect(lines[1]).toBe('# {"test":true}')
  })

  it("PLAY-05: event names include START and END pairs", async () => {
    const lines = await runTestSession()
    const dataLines = lines.slice(3)
    const events = dataLines.map((l) => l.split(",")[3])

    const expectedTypes = [
      "REQ_HOME",
      "REQ_SINF",
      "REQ_TOK",
      "WS_OPEN",
      "WS_RECV_INIT",
      "WS_SEND",
      "WS_RECV",
      "WS_CLOSE",
    ]

    for (const type of expectedTypes) {
      expect(events).toContain(`${type}_START`)
      expect(events).toContain(`${type}_END`)
    }
  })

  it("PLAY-06: timestamps are epoch milliseconds, monotonically increasing", async () => {
    const lines = await runTestSession()
    const dataLines = lines.slice(3)
    const timestamps = dataLines.map((l) => Number(l.split(",")[4]))

    for (let i = 0; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThan(1000000000000)
      if (i > 0) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]!)
      }
    }
  })

  it("PLAY-07: input_line_number matches recording file lines", async () => {
    const lines = await runTestSession()
    const dataLines = lines.slice(3)

    for (const line of dataLines) {
      const parts = line.split(",")
      const event = parts[3]!
      const lineNumber = Number(parts[5])

      if (event === "PLAYER_SESSION_CREATE" || event === "PLAYBACK_DONE") {
        expect(lineNumber).toBe(0)
      } else if (
        !event.startsWith("PLAYBACK_SLEEPBEFORE_") &&
        !event.startsWith("PLAYBACK_START_INTERVAL_")
      ) {
        expect(lineNumber).toBeGreaterThan(0)
      }
    }
  })

  it("PLAY-08: session file naming", async () => {
    const id = sessionCounter
    await runTestSession({ sessionId: id, workerId: 1, iterationId: 2 })
    const csvPath = path.join(outputDir, "sessions", `${id}_1_2.csv`)
    expect(fs.existsSync(csvPath)).toBe(true)
  })

  it("BC-04: WS_RECV matches on keys only, ignoring values", async () => {
    // Server responds with same keys but completely different values
    const altMock = new MockShinyServer({
      wsRecvResponse: JSON.stringify({
        values: { x: 999 },
        inputMessages: ["something"],
        errors: { e: "oops" },
      }),
    })
    await altMock.start()
    let tmpDir2: string | undefined
    try {
      tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-bc04-"))
      const recPath = path.join(tmpDir2, "recording.log")
      fs.writeFileSync(recPath, altMock.makeRecording())
      const outDir = path.join(tmpDir2, "output")
      createOutputDir({
        outputDir: outDir,
        overwrite: false,
        version: "test",
        recordingPath: recPath,
      })

      const rec = readRecordingFromString(fs.readFileSync(recPath, "utf-8"))
      const stats = new Stats()
      const logger = createLogger({
        name: "test",
        consoleLevel: LogLevel.ERROR,
      })

      await runSession(
        {
          sessionId: 900,
          workerId: 0,
          iterationId: 0,
          httpUrl: altMock.url,
          recording: rec,
          recordingPath: recPath,
          headers: {},
          creds: { user: null, pass: null, connectApiKey: null },
          logger,
          outputDir: outDir,
          argsString: "test",
          argsJson: "{}",
        },
        stats,
      )

      const csvPath = path.join(outDir, "sessions", "900_0_0.csv")
      const lines = fs
        .readFileSync(csvPath, "utf-8")
        .split("\n")
        .filter((l) => l.length > 0)
      const events = lines
        .filter((l) => !l.startsWith("#") && !l.startsWith("session_id"))
        .map((l) => l.split(",")[3]!)
        .filter(Boolean)

      expect(events).toContain("PLAYBACK_DONE")
      expect(stats.getCounts().done).toBe(1)
    } finally {
      if (tmpDir2) fs.rmSync(tmpDir2, { recursive: true, force: true })
      await altMock.stop()
    }
  })

  it("BC-04: WS_RECV fails when received keys differ from expected", async () => {
    // Server responds with completely different keys
    const altMock = new MockShinyServer({
      wsRecvResponse: JSON.stringify({
        differentKey: true,
      }),
    })
    await altMock.start()
    let tmpDir2: string | undefined
    try {
      tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-bc04f-"))
      const recPath = path.join(tmpDir2, "recording.log")
      fs.writeFileSync(recPath, altMock.makeRecording())
      const outDir = path.join(tmpDir2, "output")
      createOutputDir({
        outputDir: outDir,
        overwrite: false,
        version: "test",
        recordingPath: recPath,
      })

      const rec = readRecordingFromString(fs.readFileSync(recPath, "utf-8"))
      const stats = new Stats()
      const logger = createLogger({
        name: "test",
        consoleLevel: LogLevel.ERROR,
      })

      await runSession(
        {
          sessionId: 901,
          workerId: 0,
          iterationId: 0,
          httpUrl: altMock.url,
          recording: rec,
          recordingPath: recPath,
          headers: {},
          creds: { user: null, pass: null, connectApiKey: null },
          logger,
          outputDir: outDir,
          argsString: "test",
          argsJson: "{}",
        },
        stats,
      )

      const csvPath = path.join(outDir, "sessions", "901_0_0.csv")
      const lines = fs
        .readFileSync(csvPath, "utf-8")
        .split("\n")
        .filter((l) => l.length > 0)
      const events = lines
        .filter((l) => !l.startsWith("#") && !l.startsWith("session_id"))
        .map((l) => l.split(",")[3]!)
        .filter(Boolean)

      expect(events).toContain("PLAYBACK_FAIL")
      expect(stats.getCounts().failed).toBe(1)
    } finally {
      if (tmpDir2) fs.rmSync(tmpDir2, { recursive: true, force: true })
      await altMock.stop()
    }
  })

  describe("comm_id mapping helpers", () => {
    it("extractCommId extracts comm_id from valid comm_open JSON", () => {
      const json = JSON.stringify({
        content: { comm_id: "abc-123", target_name: "jupyter.widget" },
      })
      expect(extractCommId(json)).toBe("abc-123")
    })

    it("extractCommId returns null for missing content", () => {
      expect(extractCommId(JSON.stringify({ other: "data" }))).toBeNull()
    })

    it("extractCommId returns null for missing comm_id", () => {
      const json = JSON.stringify({
        content: { target_name: "jupyter.widget" },
      })
      expect(extractCommId(json)).toBeNull()
    })

    it("extractCommId returns null for non-string comm_id", () => {
      const json = JSON.stringify({ content: { comm_id: 42 } })
      expect(extractCommId(json)).toBeNull()
    })

    it("extractCommId returns null for malformed JSON", () => {
      expect(extractCommId("not json")).toBeNull()
    })

    it("replaceCommIds substitutes all mapped IDs", () => {
      const mapping = new Map([
        ["aaa-111", "bbb-222"],
        ["ccc-333", "ddd-444"],
      ])
      const input =
        '{"comm_id":"aaa-111","ident":"comm-aaa-111","other":"ccc-333"}'
      const result = replaceCommIds(input, mapping)
      expect(result).toBe(
        '{"comm_id":"bbb-222","ident":"comm-bbb-222","other":"ddd-444"}',
      )
    })

    it("replaceCommIds returns input unchanged when mapping is empty", () => {
      const input = '{"comm_id":"abc-123"}'
      expect(replaceCommIds(input, new Map())).toBe(input)
    })
  })

  it("OUT-01: output dir has sessions/, recording.log, shinyloadtest-version.txt", () => {
    expect(fs.existsSync(path.join(outputDir, "sessions"))).toBe(true)
    expect(fs.statSync(path.join(outputDir, "sessions")).isDirectory()).toBe(
      true,
    )
    expect(fs.existsSync(path.join(outputDir, "recording.log"))).toBe(true)
    expect(
      fs.existsSync(path.join(outputDir, "shinyloadtest-version.txt")),
    ).toBe(true)
    expect(
      fs.readFileSync(
        path.join(outputDir, "shinyloadtest-version.txt"),
        "utf-8",
      ),
    ).toBe("0.0.0-test")
  })
})
