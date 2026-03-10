# Jupyter Widget Support in Shinycannon

## Background

Shiny for Python apps using ipywidgets (via shinywidgets) produce WebSocket
messages that shinycannon cannot currently handle correctly. This document
describes the issues found and the fixes needed, based on investigation with a
Plotly-based NBA dashboard app.

## Bug 1: `replaceTokens` false positives on JavaScript template literals (FIXED)

**Symptom:** `[D, E, W, I, Z, J] are illegal tokens`

**Root cause:** `replaceTokens` in `Main.kt` uses the regex `\$\{([A-Z_]+)\}`
to find token placeholders like `${SESSION}` and `${WORKER}`. When
`shinywidgets_comm_open` messages contain minified JavaScript (e.g., plotly's
ESM bundle via anywidget), the JS template literals `${D}`, `${E}`, etc. are
false-positive matches. The function then rejects them as "illegal tokens."

**Fix applied:** Changed `replaceTokens` to iterate over the known allowed
tokens and replace only those, instead of finding all `${UPPERCASE}` patterns
and then validating them. This makes it ignore `${...}` patterns that happen to
appear in embedded JS code.

## Bug 2: Empty message not recognized as ignorable (FIXED)

**Symptom:** `Objects don't have same keys` — expected `{"custom":...}` but got
`{"values":{},"inputMessages":[],"errors":{}}`

**Root cause:** `canIgnore()` in `Events.kt` checks for the empty Shiny message
`{"errors":[],"values":[],"inputMessages":[]}` (with empty arrays), but Python
Shiny sends `{"values":{},"inputMessages":[],"errors":{}}` (with empty objects
for `values` and `errors`). The equality check fails, so this no-op message
enters the receive queue and gets compared against the next expected `WS_RECV`,
which is a widget `custom` message — causing a key mismatch.

**Fix applied:** Added the `{"values":{},"inputMessages":[],"errors":{}}` form
as an additional recognized empty message pattern in `canIgnore()`.

## Bug 3: Nondeterministic comm_id values (NOT YET FIXED)

**Symptom:** After fixing bugs 1 and 2, playback will likely fail because
`WS_SEND` messages reference `comm_id` values from the recording session, but
the live server assigns different `comm_id` values.

### How Jupyter widget comms work in shinywidgets

1. Server sends `shinywidgets_comm_open` (via `WS_RECV`) with a `comm_id` and
   widget state (which can be very large — plotly ESM bundles are hundreds of KB
   of minified JS).
2. Server sends `shinywidgets_comm_msg` (via `WS_RECV`) with state updates,
   referencing the same `comm_id`.
3. Client sends `shinywidgets_comm_send` (via `WS_SEND`) back to the server,
   referencing the `comm_id` for user interactions and state echoes.

### Key findings about IDs

- **`comm_id`** is the primary nondeterministic identifier in the Jupyter comm
  protocol. It is assigned by the server when a comm channel is opened.
- **`model_id`** is the ipywidgets-level name for the same value. In every case
  observed, `model_id == comm_id`. It appears in some `WS_RECV` messages but
  NOT in `WS_SEND` messages (in the test recording).
- **`ident`** fields like `"comm-432c2f5f..."` are derived from `comm_id`.
- Other hex strings in `comm_open` messages (e.g., in `document.getElementById`
  calls) are static IDs baked into the ESM JavaScript bundle, not
  nondeterministic.
- Plotly trace UIDs (e.g., `5abf2180-dd79-47ea-b4f5-23b4ca3a1f96`) appear only
  in server-to-client messages, not in `WS_SEND`.

### Proposed fix

The approach is similar to how shinycannon already handles `${SESSION}`:

1. **Capture the mapping during playback:** When processing a `WS_RECV` that
   contains `shinywidgets_comm_open`, extract the `comm_id` from both the
   recorded message and the actually-received message. Store a mapping of
   `recorded_comm_id -> actual_comm_id`. Matching can be positional (the Nth
   `comm_open` in the recording maps to the Nth in playback).

2. **Replace IDs in outgoing messages:** Before sending any `WS_SEND` message,
   do a string replacement of all mapped comm_ids throughout the entire message
   body. This handles both `"comm_id": "..."` and `"model_id": "..."` fields
   (and any other field referencing the same value) without needing to
   understand the JSON structure.

3. **Relax `WS_RECV` matching for widget messages:** The current `WS_RECV`
   handler compares top-level JSON keys between the expected and received
   messages. For `custom` messages containing widget data, the content will
   differ between sessions (different comm_ids, different trace data, etc.), but
   the structure should be the same. The existing top-level key comparison may
   be sufficient if the empty-message fix (bug 2) prevents queue desync, but
   this needs testing.

### Residual risk

At the Jupyter comm protocol level, `comm_id` is the only nondeterministic ID.
Individual widgets could theoretically embed server-generated IDs inside their
state payloads that the client echoes back, but this would be unusual widget
design. This risk is acceptable to defer until someone hits it.

## Build notes

- JCenter (`jcenter.bintray.com`) is defunct. Removed it from `pom.xml`.
- `kotlin-argparser` 2.0.3 was only on JCenter. Updated to 2.0.7 (available on
  Maven Central). This required changing `.default(null)` to
  `.default(null as Long?)` in `Main.kt` due to stricter type inference.

## Test repro

The reproduction case is in the `python-example-nba` directory of the
`shinyloadtest-example` repo. The app is an NBA dashboard using Plotly
FigureWidgets via shinywidgets. Run `run_test.sh` to reproduce.