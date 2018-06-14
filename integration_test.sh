#!/usr/bin/env bash
set -xe

## 
## Setup
##

mkdir -p ~/.R
export R_LIBS=~/.R

echo "Installing shinyloadtest"
R -e "library(devtools);devtools::install_github('rstudio/shinyloadtest')"

##
## Running Things
##

echo "Starting example server"
R -e "library(shiny);runExample('01_hello', port = 5000, launch.browser = FALSE)" &
EXAMPLE_PID=$!

sleep 1

echo "Starting recordSession"
R -e "library(shinyloadtest);shinyloadtest::recordSession('http://localhost:5000', openBrowser = FALSE, outputFile = '01_hello.log');q(save='no')" &

sleep 1

echo "Interacting with application to produce 01_hello.log"
NODE_PATH=/usr/lib/node_modules node integration_test/01_hello.js

sleep 1

SHINYCANNON=package/usr/local/bin/shinycannon

echo "Ensuring shinycannon built"
make $SHINYCANNON

echo "Simulating 3 sessions with shinycannon"
$SHINYCANNON 01_hello.log http://localhost:5000 --sessions 3

kill $EXAMPLE_PID
echo "Done"
