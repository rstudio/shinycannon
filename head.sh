#!/usr/bin/env bash
if [[ ! $(which java) ]]; then
>&2 cat << EOF
java command not found.
Please see https://rstudio.github.io/shinyloadtest/
for installation instructions.
EOF
exit 1
fi
exec java -jar "$0" "$@"
