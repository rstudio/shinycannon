#!/usr/bin/env node

// Legacy `shinycannon` command.
// Delegates to `shinyloadtest replay` from @posit-dev/shinyloadtest.

process.argv.splice(2, 0, "replay");

import("@posit-dev/shinyloadtest");
