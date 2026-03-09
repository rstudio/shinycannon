# shinycannon QA Test Plan: Behavioral Equivalence Verification

This test plan verifies behavioral equivalence between the original Kotlin/JVM
shinycannon and the TypeScript/Node.js rewrite. Each test should be run against
both implementations, and results compared.

---

## 1. Prerequisites

### 1.1 Required Software

- [ ] **Kotlin implementation:** Install the original shinycannon JAR or `.sh`
  from a GitHub release. Requires Java 8+.
- [ ] **TypeScript implementation:** Build from the `rewrite-in-typescript`
  branch. Run `npm install && npm run build`. Execute via `npx shinycannon` or
  `node dist/main.js`.
- [ ] **R** with the `shinyloadtest` package installed (for recording creation
  and result analysis).
- [ ] **A deployed Shiny application** accessible over HTTP/HTTPS for live
  tests. Ideally three environments:
  - An open (no-auth) Shiny app on a dev server (`R/Shiny` type)
  - A Shiny Server Pro app requiring username/password
  - A Posit Connect app supporting API key auth
- [ ] **diff** or **difft** for comparing output files.

### 1.2 Create a Test Recording

```r
library(shinyloadtest)
record_session("https://your-app-url.example.com/app")
# Interact with the app for 30-60 seconds, then close the browser tab.
# This produces recording.log in the working directory.
```

Verify the recording is version 1 and ends with `WS_CLOSE`:

```bash
head -5 recording.log
tail -1 recording.log
```

### 1.3 Execution Convention

Throughout this plan:
- **Kotlin:** `java -jar shinycannon.jar <args>` or `shinycannon <args>`
- **TypeScript:** `npx shinycannon <args>` or `node dist/main.js <args>`

For each test, run the command with both implementations and compare output.

### 1.4 Recording Test Files

Create these test recording files in a `_dev/qa-fixtures/` directory:

**`valid.log`** -- A real recording from shinyloadtest (version 1).

**`legacy.log`** -- A recording with only the `target` property (no `version`):
```
# target: https://example.com/app
{"type":"REQ_HOME","begin":"2023-01-01T00:00:00.000Z","url":"/","status":200}
{"type":"WS_OPEN","begin":"2023-01-01T00:00:00.100Z","url":"/websocket"}
{"type":"WS_CLOSE","begin":"2023-01-01T00:00:01.000Z"}
```

**`v99.log`** -- A recording with an unsupported version:
```
# version: 99
# target_url: https://example.com/app
# target_type: R/Shiny
{"type":"REQ_HOME","begin":"2023-01-01T00:00:00.000Z","url":"/","status":200}
{"type":"WS_CLOSE","begin":"2023-01-01T00:00:01.000Z"}
```

**`no-ws-close.log`** -- A recording not ending with `WS_CLOSE`:
```
# version: 1
# target_url: https://example.com/app
# target_type: R/Shiny
{"type":"REQ_HOME","begin":"2023-01-01T00:00:00.000Z","url":"/","status":200}
{"type":"WS_OPEN","begin":"2023-01-01T00:00:00.100Z","url":"/websocket"}
{"type":"WS_SEND","begin":"2023-01-01T00:00:00.200Z","message":"hello"}
```

**`empty.log`** -- A recording with headers but no events:
```
# version: 1
# target_url: https://example.com/app
# target_type: R/Shiny
```

---

## 2. CLI Behavior Tests

### CLI-01: Help output

| | |
|---|---|
| **Description** | Verify `--help` displays usage information |
| **Steps** | `shinycannon --help` |
| **Expected** | Displays usage, positional args (recording, app-url), all options, and environment variable documentation |
| **Pass criteria** | Both implementations list the same options with compatible descriptions. TypeScript uses `commander` format; Kotlin uses `argparser` format. The available options must match. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-02: Version output

| | |
|---|---|
| **Description** | Verify `--version` displays the version string |
| **Steps** | `shinycannon --version` |
| **Expected** | Prints a version string (e.g. `1.1.3-abc1234` for Kotlin, semver for TypeScript) |
| **Pass criteria** | Both produce version output and exit 0 |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-03: Workers -- valid values

| | |
|---|---|
| **Description** | Verify `--workers` accepts valid integer values |
| **Steps** | Run with `--workers 1`, `--workers 3`, `--workers 10` against a live app |
| **Expected** | Starts the specified number of workers |
| **Pass criteria** | Progress output shows the correct number of running workers; CSV files reflect the correct worker IDs (0 to N-1) |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-04: Workers -- invalid values

| | |
|---|---|
| **Description** | Verify `--workers` rejects invalid values |
| **Steps** | Run with `--workers 0`, `--workers -1`, `--workers abc`, `--workers 1.5` |
| **Expected** | Exits with an error message for each invalid value |
| **Pass criteria** | Both implementations reject the same set of invalid values and exit non-zero |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-05: Loaded duration minutes

| | |
|---|---|
| **Description** | Verify `--loaded-duration-minutes` controls total loaded time |
| **Steps** | Run with `--loaded-duration-minutes 0.5` (30 seconds) and `--workers 1` |
| **Expected** | After the first session completes (warmup), maintains load for approximately 30 seconds, then shuts down |
| **Pass criteria** | Total run time after warmup is approximately 30 seconds (within 5s tolerance). Both implementations produce a similar number of total sessions. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-06: Start interval -- explicit

| | |
|---|---|
| **Description** | Verify `--start-interval` overrides the default stagger |
| **Steps** | Run with `--workers 3 --start-interval 2000` |
| **Expected** | Workers start approximately 2000ms apart |
| **Pass criteria** | CSV timestamps for `PLAYBACK_START_INTERVAL_START` events show approximately 2-second gaps between workers |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-07: Start interval -- default calculation

| | |
|---|---|
| **Description** | Verify default start interval = recording_duration / num_workers |
| **Steps** | Run with `--workers 3` (no `--start-interval`). Note the recording duration from the timestamps in the recording file. |
| **Expected** | Workers start at intervals of approximately `recording_duration / 3` |
| **Pass criteria** | Both implementations compute the same default interval. CSV timestamps for worker start events show matching stagger. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-08: Custom headers -- single

| | |
|---|---|
| **Description** | Verify `-H` adds a custom header to requests |
| **Steps** | Run with `-H "X-Test-Header: test-value"`. Use `--debug-log` or a network proxy to verify the header is sent. |
| **Expected** | The custom header appears on HTTP requests and WebSocket upgrade |
| **Pass criteria** | Both implementations send the header identically |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-09: Custom headers -- multiple

| | |
|---|---|
| **Description** | Verify multiple `-H` flags work |
| **Steps** | Run with `-H "X-Header-A: alpha" -H "X-Header-B: beta"` |
| **Expected** | Both headers appear on all requests |
| **Pass criteria** | Both implementations send both headers |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-10: Output directory -- default name

| | |
|---|---|
| **Description** | Verify default output dir uses ISO timestamp with colons replaced by underscores |
| **Steps** | Run without `--output-dir` |
| **Expected** | Creates a directory named `test-logs-YYYY-MM-DDTHH_MM_SS.SSSZ` |
| **Pass criteria** | Both implementations use the same naming pattern. Colons are replaced with underscores. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-11: Output directory -- custom name

| | |
|---|---|
| **Description** | Verify `--output-dir` overrides the default |
| **Steps** | Run with `--output-dir my-test-output` |
| **Expected** | Output is written to `my-test-output/` |
| **Pass criteria** | Both implementations create the specified directory |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-12: Output directory -- already exists (no overwrite)

| | |
|---|---|
| **Description** | Verify error when output dir exists and `--overwrite-output` is not set |
| **Steps** | Create the output dir first, then run without `--overwrite-output` |
| **Expected** | Exits with error mentioning the directory already exists |
| **Pass criteria** | Both implementations produce a similar error message and exit non-zero |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-13: Overwrite output

| | |
|---|---|
| **Description** | Verify `--overwrite-output` deletes and recreates the output dir |
| **Steps** | Create the output dir with a dummy file, then run with `--overwrite-output` |
| **Expected** | Old contents are deleted; new output is written |
| **Pass criteria** | Both implementations delete and recreate the directory |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-14: Debug log

| | |
|---|---|
| **Description** | Verify `--debug-log` creates a debug.log file |
| **Steps** | Run with `--debug-log` |
| **Expected** | `<output-dir>/debug.log` is created with DEBUG-level messages |
| **Pass criteria** | Both implementations produce a debug.log. Content includes DEBUG-level entries. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-15: Log level -- each level

| | |
|---|---|
| **Description** | Verify `--log-level` controls console output verbosity |
| **Steps** | Run four times with `--log-level debug`, `--log-level info`, `--log-level warn`, `--log-level error` |
| **Expected** | Console output includes messages at or above the specified level only |
| **Pass criteria** | Both implementations filter console output consistently at each level |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-16: Missing recording file

| | |
|---|---|
| **Description** | Verify error when recording file does not exist |
| **Steps** | `shinycannon nonexistent.log https://example.com/app` |
| **Expected** | Exits with error about missing recording file |
| **Pass criteria** | Both implementations exit non-zero with a clear error message |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-17: Missing app URL

| | |
|---|---|
| **Description** | Verify error when app URL is not provided |
| **Steps** | `shinycannon recording.log` (no URL) |
| **Expected** | Exits with error about missing argument |
| **Pass criteria** | Both implementations exit non-zero |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### CLI-18: No arguments

| | |
|---|---|
| **Description** | Verify behavior when no arguments are provided |
| **Steps** | `shinycannon` |
| **Expected** | Displays help text (Kotlin shows help; TypeScript may show error or help) |
| **Pass criteria** | Both implementations exit without crashing. Note: the Kotlin version shows help when no args are given; verify TypeScript behavior is reasonable. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 3. Recording Validation Tests

### REC-01: Valid recording (version 1)

| | |
|---|---|
| **Description** | Verify a standard version 1 recording is accepted |
| **Steps** | Run with `valid.log` against a live app |
| **Expected** | Recording is parsed without errors; playback begins |
| **Pass criteria** | Both implementations start playback successfully |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### REC-02: Legacy recording (no version, has `target`)

| | |
|---|---|
| **Description** | Verify legacy recording format is auto-upgraded |
| **Steps** | Run with `legacy.log` |
| **Expected** | Recording is auto-upgraded to version 1 with `target_type: Unknown`. Playback proceeds (may fail at HTTP stage if no real server, but parsing succeeds). |
| **Pass criteria** | Both implementations accept the legacy format without parsing errors |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### REC-03: Unsupported recording version

| | |
|---|---|
| **Description** | Verify recordings with version > 1 are rejected |
| **Steps** | Run with `v99.log` |
| **Expected** | Exits with error about unsupported version and suggestion to upgrade |
| **Pass criteria** | Both implementations exit non-zero with a message about version 99 being newer than supported |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### REC-04: Recording not ending with WS_CLOSE

| | |
|---|---|
| **Description** | Verify recordings that don't end with WS_CLOSE are rejected |
| **Steps** | Run with `no-ws-close.log` |
| **Expected** | Exits with error about recording not ending with WS_CLOSE |
| **Pass criteria** | Both implementations reject the recording with a clear error message |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### REC-05: Empty recording (no events)

| | |
|---|---|
| **Description** | Verify recordings with no events are rejected |
| **Steps** | Run with `empty.log` |
| **Expected** | Exits with error about empty recording |
| **Pass criteria** | Both implementations reject the recording |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 4. Authentication Tests

### AUTH-01: No authentication (open app)

| | |
|---|---|
| **Description** | Verify playback works against an open (no-auth) Shiny app |
| **Steps** | Run against an open app with no auth env vars set |
| **Expected** | Playback completes successfully |
| **Pass criteria** | Both implementations complete sessions with `PLAYBACK_DONE` events |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### AUTH-02: SSP username/password authentication

| | |
|---|---|
| **Description** | Verify SSP login with SHINYCANNON_USER/SHINYCANNON_PASS |
| **Steps** | Set `SHINYCANNON_USER` and `SHINYCANNON_PASS` env vars, run against an SSP app |
| **Expected** | Login succeeds, playback completes |
| **Pass criteria** | Both implementations authenticate and produce successful sessions |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### AUTH-03: Connect API key authentication

| | |
|---|---|
| **Description** | Verify Connect login with SHINYCANNON_CONNECT_API_KEY |
| **Steps** | Set `SHINYCANNON_CONNECT_API_KEY`, run against a Connect app (use a recording made with an API key) |
| **Expected** | API key is sent as `Authorization: Key <key>` header; playback completes |
| **Pass criteria** | Both implementations authenticate and produce successful sessions |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### AUTH-04: Connect username/password authentication

| | |
|---|---|
| **Description** | Verify Connect login with SHINYCANNON_USER/SHINYCANNON_PASS |
| **Steps** | Set `SHINYCANNON_USER` and `SHINYCANNON_PASS`, run against a Connect app (use a recording made without an API key) |
| **Expected** | JSON login to `__login__` endpoint succeeds; playback completes |
| **Pass criteria** | Both implementations authenticate via JSON POST and produce successful sessions |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### AUTH-05: Credentials set but app is open

| | |
|---|---|
| **Description** | Verify warning when credentials are provided but app doesn't need auth |
| **Steps** | Set `SHINYCANNON_USER` and `SHINYCANNON_PASS`, run against an open app |
| **Expected** | Warning logged about credentials being set but app not requiring auth. Playback proceeds. |
| **Pass criteria** | Both implementations log a similar warning message and continue playback |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### AUTH-06: API key required but not provided

| | |
|---|---|
| **Description** | Verify error when recording requires API key but none is set |
| **Steps** | Use a recording with `rscApiKeyRequired: true` but do not set `SHINYCANNON_CONNECT_API_KEY` |
| **Expected** | Exits with error about missing API key |
| **Pass criteria** | Both implementations exit non-zero with a clear error message |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### AUTH-07: API key provided but recording doesn't require it

| | |
|---|---|
| **Description** | Verify error when API key is provided but recording was made without one |
| **Steps** | Set `SHINYCANNON_CONNECT_API_KEY`, use a recording with `rscApiKeyRequired: false` |
| **Expected** | Exits with error about unexpected API key |
| **Pass criteria** | Both implementations exit non-zero with a clear error message |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### AUTH-08: Connect URL with hash fragment

| | |
|---|---|
| **Description** | Verify error when Connect URL contains `#` |
| **Steps** | Run against a Connect app URL containing `#` (e.g. `https://connect.example.com/app#section`) |
| **Expected** | Exits with error asking for the content URL (solo mode) |
| **Pass criteria** | Both implementations detect the `#` and exit with a similar error message |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 5. Session Playback Tests

### PLAY-01: Single worker, single iteration

| | |
|---|---|
| **Description** | Verify basic playback with 1 worker and very short loaded duration |
| **Steps** | `shinycannon recording.log <app-url> --workers 1 --loaded-duration-minutes 0.01 --output-dir play01-output` |
| **Expected** | One complete session is played back. Output directory contains one CSV file. |
| **Pass criteria** | Both implementations produce a CSV with the same sequence of event types (PLAYER_SESSION_CREATE, REQ_HOME_START, REQ_HOME_END, ..., WS_CLOSE_END, PLAYBACK_DONE) |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### PLAY-02: Multiple workers with staggered start

| | |
|---|---|
| **Description** | Verify multiple workers start at staggered intervals |
| **Steps** | `shinycannon recording.log <app-url> --workers 3 --loaded-duration-minutes 0.5 --start-interval 1000 --output-dir play02-output` |
| **Expected** | Three workers start approximately 1 second apart. Each produces at least one CSV file. |
| **Pass criteria** | Worker start times (from PLAYBACK_START_INTERVAL_START timestamps) show approximately 1-second stagger. Both implementations produce the same number of session files. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### PLAY-03: CSV column names

| | |
|---|---|
| **Description** | Verify CSV output has correct column headers |
| **Steps** | Inspect any session CSV file from PLAY-01 |
| **Expected** | Third line (after two comment lines) is: `session_id,worker_id,iteration,event,timestamp,input_line_number,comment` |
| **Pass criteria** | Column names are identical in both implementations |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### PLAY-04: CSV comment lines

| | |
|---|---|
| **Description** | Verify CSV files start with two comment lines |
| **Steps** | Inspect any session CSV file from PLAY-01 |
| **Expected** | Line 1: `# <args string>`. Line 2: `# <args json>`. |
| **Pass criteria** | Both implementations write two comment lines. The args string contains the app URL, workers, loaded-duration-minutes, output-dir, and log-level. The JSON line is valid JSON. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### PLAY-05: CSV event names

| | |
|---|---|
| **Description** | Verify event names in CSV match exactly |
| **Steps** | Extract the `event` column from CSV files produced by both implementations |
| **Expected** | Event names use the exact strings: `PLAYER_SESSION_CREATE`, `PLAYBACK_START_INTERVAL_START/END`, `PLAYBACK_SLEEPBEFORE_START/END`, `REQ_HOME_START/END`, `REQ_SINF_START/END`, `REQ_TOK_START/END`, `REQ_GET_START/END`, `REQ_POST_START/END`, `WS_OPEN_START/END`, `WS_SEND_START/END`, `WS_RECV_START/END`, `WS_RECV_INIT_START/END`, `WS_RECV_BEGIN_UPLOAD_START/END`, `WS_CLOSE_START/END`, `PLAYBACK_DONE`, `PLAYBACK_FAIL` |
| **Pass criteria** | The set of distinct event names matches between implementations |

```bash
# Extract unique event names from a CSV
tail -n +4 sessions/*.csv | cut -d',' -f4 | sort -u
```

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### PLAY-06: CSV timestamp format

| | |
|---|---|
| **Description** | Verify timestamps are Unix epoch milliseconds |
| **Steps** | Inspect the `timestamp` column values in CSV output |
| **Expected** | All timestamps are 13-digit integers (Unix epoch milliseconds) |
| **Pass criteria** | Both implementations use the same timestamp format (integer, not float, no fractional milliseconds) |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### PLAY-07: CSV file naming

| | |
|---|---|
| **Description** | Verify session CSV files are named `{session_id}_{worker_id}_{iteration_id}.csv` |
| **Steps** | List files in `<output-dir>/sessions/` |
| **Expected** | Files are named like `0_0_0.csv`, `1_1_0.csv`, `2_2_0.csv`, etc. |
| **Pass criteria** | Both implementations use the same naming convention |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### PLAY-08: Input line numbers

| | |
|---|---|
| **Description** | Verify `input_line_number` in CSV is 1-based and matches the recording file |
| **Steps** | Cross-reference `input_line_number` values in the CSV with line numbers in the recording file |
| **Expected** | Each event's `input_line_number` corresponds to the correct line in the recording |
| **Pass criteria** | Both implementations assign the same line numbers to events |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### PLAY-09: Event ordering within a session

| | |
|---|---|
| **Description** | Verify events appear in the same order as the recording |
| **Steps** | Extract event names from a single session CSV (excluding PLAYER_SESSION_CREATE, sleep events, and PLAYBACK_DONE) |
| **Expected** | The sequence of `*_START/*_END` events mirrors the order of events in the recording file |
| **Pass criteria** | Both implementations produce events in the same order |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 6. Output Directory Structure Tests

### OUT-01: Directory structure

| | |
|---|---|
| **Description** | Verify the output directory has the correct structure |
| **Steps** | Inspect `<output-dir>/` after a run |
| **Expected** | Contains: `shinycannon-version.txt`, `recording.log`, `sessions/` (directory with CSV files). If `--debug-log` was used, also `debug.log`. |
| **Pass criteria** | Both implementations create the same directory structure |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### OUT-02: Version file

| | |
|---|---|
| **Description** | Verify `shinycannon-version.txt` contains the version string |
| **Steps** | `cat <output-dir>/shinycannon-version.txt` |
| **Expected** | Contains the version string of the running implementation |
| **Pass criteria** | Both implementations write a version file (content will differ by implementation) |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### OUT-03: Recording copy

| | |
|---|---|
| **Description** | Verify the recording file is copied into the output directory |
| **Steps** | `diff recording.log <output-dir>/recording.log` |
| **Expected** | Files are identical |
| **Pass criteria** | Both implementations produce a byte-identical copy of the recording file |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 7. Endurance Test Behavior

### END-01: Warmup phase

| | |
|---|---|
| **Description** | Verify all workers complete their first session before loaded duration starts |
| **Steps** | Run with `--workers 3 --loaded-duration-minutes 1`. Observe logs. |
| **Expected** | Log shows "Waiting for warmup to complete" followed by "Maintaining for 1 minutes" only after all workers have completed their first session |
| **Pass criteria** | Both implementations wait for all workers to finish warmup before starting the loaded duration timer |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### END-02: Workers loop after first session

| | |
|---|---|
| **Description** | Verify workers start new sessions after completing their first |
| **Steps** | Run with `--workers 1 --loaded-duration-minutes 1` using a short recording (< 10s) |
| **Expected** | Multiple CSV files are produced for the same worker with incrementing iteration IDs |
| **Pass criteria** | Both implementations produce files like `0_0_0.csv`, `1_0_1.csv`, `2_0_2.csv`, etc. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### END-03: Shutdown after loaded duration

| | |
|---|---|
| **Description** | Verify workers stop after loaded duration expires |
| **Steps** | Run with `--loaded-duration-minutes 0.5`. Time the total run. |
| **Expected** | Workers stop starting new sessions after approximately 30 seconds of loaded time (plus warmup) |
| **Pass criteria** | Both implementations shut down within a similar time window. Final log shows "Complete. Failed: X, Done: Y". |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### END-04: Workers finish current session before stopping

| | |
|---|---|
| **Description** | Verify workers complete their in-progress session before exiting |
| **Steps** | Run with `--workers 1 --loaded-duration-minutes 0.01` using a recording that takes > 10 seconds to play back |
| **Expected** | The last session CSV ends with `PLAYBACK_DONE`, not `PLAYBACK_FAIL` |
| **Pass criteria** | Both implementations allow the current session to finish before the worker exits |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### END-05: Progress reporting

| | |
|---|---|
| **Description** | Verify progress stats are logged every 5 seconds |
| **Steps** | Run with `--workers 2 --loaded-duration-minutes 1 --log-level info`. Capture console output. |
| **Expected** | Console shows `Running: X, Failed: Y, Done: Z` messages approximately every 5 seconds |
| **Pass criteria** | Both implementations report progress in the same format at approximately the same interval. The `Running:`, `Failed:`, `Done:` label order matches. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### END-06: Final summary

| | |
|---|---|
| **Description** | Verify final summary message format |
| **Steps** | Observe the final log line after a successful run |
| **Expected** | Log shows `Complete. Failed: X, Done: Y` |
| **Pass criteria** | Both implementations produce a final summary in the same format |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 8. Error Handling Tests

### ERR-01: Target app is down

| | |
|---|---|
| **Description** | Verify behavior when the target app URL is unreachable |
| **Steps** | Run against `https://localhost:99999/nonexistent` |
| **Expected** | Session fails with a connection error. CSV shows `PLAYBACK_FAIL`. |
| **Pass criteria** | Both implementations fail gracefully, log an error, and produce a CSV with `PLAYBACK_FAIL` |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### ERR-02: HTTP status mismatch

| | |
|---|---|
| **Description** | Verify behavior when the server returns an unexpected status code |
| **Steps** | Modify a recording to expect status 200 but point at a URL that returns 404 (or use a misconfigured app) |
| **Expected** | Session fails with a status mismatch error |
| **Pass criteria** | Both implementations detect the mismatch, fail the session, and log the expected vs actual status |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### ERR-03: 200/304 status equivalence

| | |
|---|---|
| **Description** | Verify that status codes 200 and 304 are treated as interchangeable |
| **Steps** | Use a recording where an HTTP event expects status 200 but the server returns 304 (or vice versa). This may require a caching proxy. |
| **Expected** | No error; the status is accepted |
| **Pass criteria** | Both implementations treat 200 and 304 as equivalent |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### ERR-04: WebSocket disconnect mid-session

| | |
|---|---|
| **Description** | Verify behavior when the server closes the WebSocket unexpectedly |
| **Steps** | Use a Shiny app that programmatically disconnects after a delay, or kill the app mid-session |
| **Expected** | Session fails with "Server closed websocket connection" error |
| **Pass criteria** | Both implementations detect the server-initiated close, fail the session, and log the error |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### ERR-05: Process exit code on success

| | |
|---|---|
| **Description** | Verify the process exits with code 0 on successful completion |
| **Steps** | Run a successful test and check `$?` |
| **Expected** | Exit code is 0 |
| **Pass criteria** | Both implementations exit with code 0 |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### ERR-06: Process exit code on startup error

| | |
|---|---|
| **Description** | Verify the process exits with non-zero code on startup errors |
| **Steps** | Run with a nonexistent recording file; check `$?` |
| **Expected** | Exit code is non-zero (1) |
| **Pass criteria** | Both implementations exit with a non-zero code |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 9. Server Type Detection Tests

### DET-01: shinyapps.io detection

| | |
|---|---|
| **Description** | Verify SAI detection by hostname |
| **Steps** | Run against an app at `*.shinyapps.io` (or observe detection log at `--log-level info`) |
| **Expected** | Detected type is "shinyapps.io" |
| **Pass criteria** | Both implementations detect SAI by hostname |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### DET-02: Shiny Server Pro detection

| | |
|---|---|
| **Description** | Verify SSP detection |
| **Steps** | Run against an SSP app with `--log-level info` |
| **Expected** | Detected type is "Shiny Server or Shiny Server Pro" |
| **Pass criteria** | Both implementations detect SSP |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### DET-03: Connect detection

| | |
|---|---|
| **Description** | Verify RSC detection |
| **Steps** | Run against a Connect app with `--log-level info` |
| **Expected** | Detected type is "RStudio Server Connect" |
| **Pass criteria** | Both implementations detect RSC |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### DET-04: R/Shiny dev server detection

| | |
|---|---|
| **Description** | Verify SHN detection for a local Shiny dev server |
| **Steps** | Run against a local Shiny app (started with `shiny::runApp()`) with `--log-level info` |
| **Expected** | Detected type is "R/Shiny" |
| **Pass criteria** | Both implementations detect SHN by the presence of shiny.js in the response body |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### DET-05: Non-Shiny URL

| | |
|---|---|
| **Description** | Verify error when URL does not serve a Shiny app |
| **Steps** | Run against `https://www.example.com` |
| **Expected** | Exits with error "does not appear to be a Shiny application" |
| **Pass criteria** | Both implementations detect the non-Shiny target and exit with a similar error |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### DET-06: Server type mismatch warning

| | |
|---|---|
| **Description** | Verify warning when detected type differs from recording type |
| **Steps** | Use a recording with `target_type: RStudio Server Connect` but run against a dev server |
| **Expected** | Warning logged about type mismatch. Playback continues. |
| **Pass criteria** | Both implementations log a similar warning but do not abort |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 10. Output Compatibility with shinyloadtest

### COMPAT-01: CSV parseable by shinyloadtest

| | |
|---|---|
| **Description** | Verify shinyloadtest R package can read and analyze output from both implementations |
| **Steps** | Run a load test with each implementation, then in R: |

```r
library(shinyloadtest)
df_kotlin <- load_runs("kotlin-output/")
df_ts <- load_runs("ts-output/")

# Verify both produce valid data frames
str(df_kotlin)
str(df_ts)

# Verify column names match
identical(names(df_kotlin), names(df_ts))

# Verify event types match
identical(sort(unique(df_kotlin$event)), sort(unique(df_ts$event)))
```

| **Expected** | Both outputs are successfully parsed by `load_runs()` with identical column names and event types |
| **Pass criteria** | `load_runs()` succeeds for both. Column names and event type values are identical. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### COMPAT-02: Side-by-side CSV structure comparison

| | |
|---|---|
| **Description** | Detailed comparison of CSV file structure between implementations |
| **Steps** | From a single-worker, single-iteration run on both implementations, compare the first session CSV |

```bash
# Compare comment lines format
head -2 kotlin-output/sessions/0_0_0.csv
head -2 ts-output/sessions/0_0_0.csv

# Compare column headers
sed -n '3p' kotlin-output/sessions/0_0_0.csv
sed -n '3p' ts-output/sessions/0_0_0.csv

# Compare event sequences (ignoring timestamps)
awk -F',' '{print $4}' kotlin-output/sessions/0_0_0.csv | tail -n +4
awk -F',' '{print $4}' ts-output/sessions/0_0_0.csv | tail -n +4
```

| **Expected** | Comment line format, column headers, and event sequences are compatible |
| **Pass criteria** | Column headers are identical. Event sequences are identical. Comment lines follow the same format (args string, then args JSON). |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 11. Behavioral Constraints Checklist

These tests verify the specific behavioral constraints listed in the spec
(Section 10). Each constraint must be preserved.

### BC-01: Recording must end with WS_CLOSE

| | |
|---|---|
| **Description** | Validated at startup |
| **Covered by** | REC-04 |

### BC-02: 200/304 status equivalence

| | |
|---|---|
| **Description** | HTTP events treat 200 and 304 as interchangeable |
| **Covered by** | ERR-03 |

### BC-03: WebSocket receive queue bounded at 50

| | |
|---|---|
| **Description** | Queue overflow produces a fatal error mentioning GitHub issue |
| **Steps** | This is difficult to trigger manually. Verify in code review that both implementations use a bounded queue of size 50. Optionally, use a mock server that floods WebSocket messages. |
| **Pass criteria** | Code review confirms queue capacity of 50 in both implementations. Error message mentions filing a GitHub issue. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### BC-04: WS_RECV compares only top-level JSON keys

| | |
|---|---|
| **Description** | Key-only comparison, not structural equality |
| **Steps** | Code review. Verify in both implementations that `WS_RECV` compares `Object.keys()` / `keySet()` only. |
| **Pass criteria** | Code review confirms both implementations use key-only comparison |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### BC-05: Default start interval = recording_duration / num_workers

| | |
|---|---|
| **Description** | Even stagger across workers |
| **Covered by** | CLI-07 |

### BC-06: Colons replaced with underscores in output dir names

| | |
|---|---|
| **Description** | Windows filename compatibility |
| **Covered by** | CLI-10 |

### BC-07: Recording file copied into output directory

| | |
|---|---|
| **Description** | For reproducibility |
| **Covered by** | OUT-03 |

### BC-08: CLI args serialized to JSON in CSV comments

| | |
|---|---|
| **Description** | Args appear as JSON on line 2 of each CSV |
| **Covered by** | PLAY-04 |

### BC-09: Server-initiated WebSocket close is a session failure

| | |
|---|---|
| **Description** | Treated as failure, not graceful completion |
| **Covered by** | ERR-04 |

### BC-10: SockJS "o" message is valid (returns null, not ignored)

| | |
|---|---|
| **Description** | The "o" open frame passes through canIgnore() and returns null from parseMessage() |
| **Steps** | Code review of `canIgnore()` and `parseMessage()` in both implementations. Verify `canIgnore("o")` returns `false` and `parseMessage("o")` returns `null`. |
| **Pass criteria** | Both implementations handle "o" identically |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### BC-11: Reconnect-enabled message IDs normalized for matching

| | |
|---|---|
| **Description** | Hex prefix before `#` replaced with `*` |
| **Steps** | Code review. Verify the normalization regex `^a\["[0-9A-F]+#` -> `a["*#` is present in both implementations. |
| **Pass criteria** | Both implementations apply the same normalization |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### BC-12: Process exits cleanly

| | |
|---|---|
| **Description** | No hanging threads/timers after completion |
| **Steps** | Run a load test. Verify the process exits within a few seconds of the final log message. |
| **Pass criteria** | Both implementations exit promptly. (Kotlin uses `System.exit(0)` as a workaround; TypeScript should exit naturally or explicitly.) |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## 12. Log Format Tests

### LOG-01: Console log format

| | |
|---|---|
| **Description** | Verify console log line format |
| **Steps** | Run with `--log-level info` and capture stderr |
| **Expected** | Lines follow format: `yyyy-MM-dd HH:mm:ss.SSS LEVEL [thread-name] - message` |
| **Pass criteria** | Both implementations use the same timestamp format and level/thread/message layout. Thread names follow the pattern `thread00` (main), `thread01`, `thread02`, etc. |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

### LOG-02: Worker thread naming

| | |
|---|---|
| **Description** | Verify worker threads/loggers use consistent naming |
| **Steps** | Run with `--workers 3 --log-level info`, inspect log output |
| **Expected** | Main thread logs as `thread00` or `main`. Workers log as `thread01`, `thread02`, `thread03`. |
| **Pass criteria** | Both implementations use the same thread naming scheme |

| Impl | Pass/Fail | Notes |
|------|-----------|-------|
| Kotlin | [ ] | |
| TypeScript | [ ] | |

---

## Summary Checklist

| Category | Tests | Total |
|----------|-------|-------|
| CLI Behavior | CLI-01 through CLI-18 | 18 |
| Recording Validation | REC-01 through REC-05 | 5 |
| Authentication | AUTH-01 through AUTH-08 | 8 |
| Session Playback | PLAY-01 through PLAY-09 | 9 |
| Output Structure | OUT-01 through OUT-03 | 3 |
| Endurance Behavior | END-01 through END-06 | 6 |
| Error Handling | ERR-01 through ERR-06 | 6 |
| Server Detection | DET-01 through DET-06 | 6 |
| Output Compatibility | COMPAT-01 through COMPAT-02 | 2 |
| Behavioral Constraints | BC-01 through BC-12 | 12 |
| Log Format | LOG-01 through LOG-02 | 2 |
| **Total** | | **77** |
