/**
 * Legacy `shinycannon` CLI entry point.
 * Acts as an alias for `shinyloadtest replay <args>`.
 */

// Inject "replay" as the subcommand before the main CLI parses argv,
// unless the user already typed `shinycannon replay ...`.
if (process.argv[2] !== "replay") {
  process.argv.splice(2, 0, "replay")
}

import("./main.js")
