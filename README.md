# proxyrec

This is an experimental, work-in-progress tool to create and run load tests for Shiny applications.

Shiny is not a good fit for traditional HTTP load testing tools like ApacheBench, as they are designed for the stateless HTTP request/response model. Shiny apps, on the other hand, do much of their communication over stateful WebSockets, using its own application-level protocol.

`proxyrec` lets you **record** an example Shiny session by proxying traffic to a Shiny app (or Shiny Server, or RStudio Connect); then, at any point in the future, perform a load test via **playback** of the recorded session across many concurrent threads.

## Install

Install Node v8.4.0, then navigate to this repo's directory and run:

```
npm install
```

## Run

```
node lib/main.js --help
```

## License

GPLv3
