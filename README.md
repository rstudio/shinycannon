# shinycannon

A load-generation tool for [Shiny](https://shiny.posit.co/) applications.
shinycannon replays recorded sessions against a deployed Shiny app, simulating
concurrent users to measure application performance under load.

## Installation

Requires **Node.js 20+**.

Install globally via npm:

```bash
npm install -g shinycannon
```

Or run directly with npx:

```bash
npx shinycannon --help
```

## Usage

```bash
shinycannon recording.log https://example.com/app [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--workers <n>` | Number of concurrent workers (default: 1) |
| `--loaded-duration-minutes <n>` | Minutes to maintain load after warmup (default: 5) |
| `--start-interval <ms>` | Milliseconds between starting workers (default: recording duration / workers) |
| `-H, --header <header>` | Custom HTTP header, repeatable |
| `--output-dir <dir>` | Directory for session logs |
| `--overwrite-output` | Overwrite existing output directory |
| `--debug-log` | Write verbose debug log |
| `--log-level <level>` | Console log level: `debug`, `info`, `warn`, `error` (default: `warn`) |

## Authentication

shinycannon supports authentication via environment variables:

| Variable | Purpose |
|----------|---------|
| `SHINYCANNON_USER` | Username for Shiny Server Pro or Posit Connect |
| `SHINYCANNON_PASS` | Password for Shiny Server Pro or Posit Connect |
| `SHINYCANNON_CONNECT_API_KEY` | API key for Posit Connect |

> **Note:** If the recording was made with a Connect API key, playback must
> also use a Connect API key. Likewise, if the recording was made without an
> API key, playback must not use one.

## Example

```bash
shinycannon recording.log https://rsc.example.com/app \
  --workers 5 \
  --loaded-duration-minutes 10 \
  --output-dir load-test-results
```

## Companion Package

shinycannon is designed to work with the
[shinyloadtest](https://rstudio.github.io/shinyloadtest) R package.
Use shinyloadtest to record sessions and analyze load test results.

## Migration from Kotlin Version

This is a TypeScript rewrite of shinycannon, which was originally implemented
in Kotlin on the JVM. The rewrite uses the same recording format, the same
output format, and the same CLI interface. Existing recordings and analysis
workflows are fully compatible. The original Kotlin source is archived in the
`_archive/kotlin/` directory.

## License

MIT
