import * as http from "node:http"
import { WebSocketServer, WebSocket } from "ws"

export interface MockShinyServerOptions {
  /** Delay in ms before responding to HTTP requests (default: 0) */
  httpDelay?: number
  /** Delay in ms before sending WS init message (default: 0) */
  wsInitDelay?: number
  /** If set, return this status for GET / instead of 200 */
  homeStatus?: number
  /** If true, close the WS connection after init (simulates disconnect) */
  wsDropAfterInit?: boolean
  /** Delay before sending WS_RECV responses (default: 0) */
  wsRecvDelay?: number
  /** If true, don't send WS init message at all */
  wsNoInit?: boolean
  /** Custom JSON string to send as WS_RECV response */
  wsRecvResponse?: string
  /** If set, flood this many WS messages right after init (to overflow receive queue) */
  wsFloodCount?: number
}

export class MockShinyServer {
  private server: http.Server
  private wss: WebSocketServer
  private port = 0
  private sessionCounter = 0
  private connections: Set<WebSocket> = new Set()
  private httpConnections: Set<import("node:net").Socket> = new Set()

  constructor(private options: MockShinyServerOptions = {}) {
    this.server = http.createServer(this.handleHttp.bind(this))
    this.wss = new WebSocketServer({ server: this.server })
    this.wss.on("connection", this.handleWs.bind(this))

    this.server.on("connection", (socket) => {
      this.httpConnections.add(socket)
      socket.on("close", () => this.httpConnections.delete(socket))
    })
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address() as import("node:net").AddressInfo
        this.port = addr.port
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    for (const ws of this.connections) {
      ws.close()
    }
    this.connections.clear()

    for (const socket of this.httpConnections) {
      socket.destroy()
    }
    this.httpConnections.clear()

    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => resolve())
      })
    })
  }

  /**
   * Generate a recording string that matches this server's endpoints.
   * Uses a simple flow: GET /, GET __sockjs__/info, GET __token__,
   * WS_OPEN, WS_RECV_INIT, WS_SEND, WS_RECV, WS_CLOSE
   */
  makeRecording(): string {
    const T0 = "2020-01-01T00:00:00.000Z"
    const T1 = "2020-01-01T00:00:00.100Z"
    const T2 = "2020-01-01T00:00:00.200Z"
    const T3 = "2020-01-01T00:00:00.300Z"
    const T4 = "2020-01-01T00:00:00.400Z"
    const T5 = "2020-01-01T00:00:00.500Z"
    const T6 = "2020-01-01T00:00:00.600Z"
    const T7 = "2020-01-01T00:00:00.700Z"

    const headers = [
      "# version: 1",
      `# target_url: ${this.url}`,
      "# target_type: R/Shiny",
    ]

    const events = [
      JSON.stringify({ type: "REQ_HOME", begin: T0, url: "/", status: 200 }),
      JSON.stringify({
        type: "REQ_SINF",
        begin: T1,
        url: "/__sockjs__/info",
        status: 200,
      }),
      JSON.stringify({
        type: "REQ_TOK",
        begin: T2,
        url: "/__token__",
        status: 200,
      }),
      JSON.stringify({
        type: "WS_OPEN",
        begin: T3,
        url: "/__sockjs__/000/${SOCKJSID}/websocket",
      }),
      JSON.stringify({
        type: "WS_RECV_INIT",
        begin: T4,
        message: '{"config":{"sessionId":"${SESSION}"}}',
      }),
      JSON.stringify({
        type: "WS_SEND",
        begin: T5,
        message: '{"method":"init","data":{"user":null}}',
      }),
      JSON.stringify({
        type: "WS_RECV",
        begin: T6,
        message: '{"values":{"x":1},"inputMessages":[],"errors":{}}',
      }),
      JSON.stringify({ type: "WS_CLOSE", begin: T7 }),
    ]

    return [...headers, ...events].join("\n")
  }

  private handleHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const delay = this.options.httpDelay ?? 0

    const respond = (): void => {
      const url = req.url ?? "/"

      if (url === "/" || url.startsWith("/?")) {
        const status = this.options.homeStatus ?? 200
        res.writeHead(status, { "Content-Type": "text/html" })
        res.end(
          "<!DOCTYPE html>\n<html><head>\n" +
            '<base href="_w_abc123/">\n' +
            '<script src="shared/shiny.min.js"></script>\n' +
            "</head><body>Shiny App</body></html>",
        )
        return
      }

      if (url.includes("__sockjs__") && url.endsWith("/info")) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            websocket: true,
            cookie_needed: false,
            origins: ["*:*"],
            entropy: Math.floor(Math.random() * 1e9),
          }),
        )
        return
      }

      if (url.includes("__token__")) {
        res.writeHead(200, { "Content-Type": "text/plain" })
        res.end("mock-token-value")
        return
      }

      if (url.includes("/shared/") || url.startsWith("/_w_")) {
        res.writeHead(200, { "Content-Type": "application/javascript" })
        res.end("// mock resource")
        return
      }

      res.writeHead(404)
      res.end("Not found")
    }

    if (delay > 0) {
      setTimeout(respond, delay)
    } else {
      respond()
    }
  }

  private handleWs(ws: WebSocket): void {
    this.connections.add(ws)
    ws.on("close", () => this.connections.delete(ws))

    const sessionId = `session-${this.sessionCounter++}`
    const initDelay = this.options.wsInitDelay ?? 0

    const sendInit = (): void => {
      if (this.options.wsNoInit) return

      const initMsg = JSON.stringify({
        config: { sessionId },
        custom: {},
      })
      ws.send(initMsg)

      if (this.options.wsDropAfterInit) {
        setTimeout(() => ws.close(), 10)
        return
      }

      if (this.options.wsFloodCount) {
        for (let i = 0; i < this.options.wsFloodCount; i++) {
          ws.send(JSON.stringify({ flood: i }))
        }
      }
    }

    if (initDelay > 0) {
      setTimeout(sendInit, initDelay)
    } else {
      sendInit()
    }

    ws.on("message", (_data) => {
      const recvDelay = this.options.wsRecvDelay ?? 0

      const response =
        this.options.wsRecvResponse ??
        JSON.stringify({
          values: { x: 1 },
          inputMessages: [],
          errors: {},
        })

      const doSend = (): void => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(response)
        }
      }

      if (recvDelay > 0) {
        setTimeout(doSend, recvDelay)
      } else {
        doSend()
      }
    })
  }
}
