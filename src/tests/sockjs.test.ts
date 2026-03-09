import { describe, it, expect } from "vitest";
import { parseMessage, normalizeMessage, canIgnore } from "../sockjs.js";

describe("normalizeMessage", () => {
  it("replaces reconnect message IDs with *", () => {
    const msg = 'a["A3#0|m|{\\"key\\":\\"value\\"}"]';
    expect(normalizeMessage(msg)).toBe('a["*#0|m|{\\"key\\":\\"value\\"}"]');
  });

  it("leaves non-reconnect messages unchanged", () => {
    const msg = 'a["0|m|{\\"key\\":\\"value\\"}"]';
    expect(normalizeMessage(msg)).toBe(msg);
  });
});

describe("parseMessage", () => {
  it("parses reconnect-enabled format", () => {
    const m1 =
      'a["1#0|m|{\\"config\\":{\\"sessionId\\":\\"a string inside\\",\\"user\\":null}}"]';
    const parsed = parseMessage(m1);
    expect(parsed?.config).toEqual({ sessionId: "a string inside", user: null });
  });

  it("parses reconnect-disabled format", () => {
    const m1 =
      'a["0|m|{\\"config\\":{\\"sessionId\\":\\"a string inside\\",\\"user\\":null}}"]';
    const parsed = parseMessage(m1);
    expect(parsed?.config).toEqual({ sessionId: "a string inside", user: null });
  });

  it("returns null for SockJS open frame", () => {
    expect(parseMessage("o")).toBeNull();
  });

  it("parses raw JSON (dev/SSO format)", () => {
    const msg = '{"config":{"sessionId":"abc"}}';
    const parsed = parseMessage(msg);
    expect(parsed?.config).toEqual({ sessionId: "abc" });
  });
});

describe("canIgnore", () => {
  it("ignores ACK messages", () => {
    expect(canIgnore('a["ACK 2"]')).toBe(true);
    expect(canIgnore('["ACK 2"]')).toBe(true);
  });

  it("ignores heartbeat", () => {
    expect(canIgnore("h")).toBe(true);
  });

  it("does not ignore SockJS open", () => {
    expect(canIgnore("o")).toBe(false);
  });

  it("ignores busy/progress/recalculating messages", () => {
    expect(canIgnore('a["2#0|m|{\\"busy\\":\\"busy\\"}"]')).toBe(true);
    expect(
      canIgnore(
        'a["3#0|m|{\\"recalculating\\":{\\"name\\":\\"distPlot\\",\\"status\\":\\"recalculating\\"}}"]',
      ),
    ).toBe(true);
    expect(canIgnore('a["5#0|m|{\\"busy\\":\\"idle\\"}"]')).toBe(true);
  });

  it("ignores empty update messages", () => {
    expect(
      canIgnore(
        'a["6#0|m|{\\"errors\\":[],\\"values\\":[],\\"inputMessages\\":[]}"]',
      ),
    ).toBe(true);
  });

  it("does not ignore real data messages", () => {
    expect(
      canIgnore(
        'a["0#0|m|{\\"custom\\":{\\"credentials\\":null,\\"license\\":{\\"status\\":\\"activated\\"}}}"]',
      ),
    ).toBe(false);
    expect(
      canIgnore(
        'a["1#0|m|{\\"config\\":{\\"workerId\\":\\"139eab2\\",\\"sessionId\\":\\"abc\\",\\"user\\":null}}"]',
      ),
    ).toBe(false);
  });

  it("ignores reactlog custom messages", () => {
    expect(canIgnore('{"custom":{"reactlog":{"some":"data"}}}')).toBe(true);
  });

  it("does not ignore non-reactlog custom messages", () => {
    expect(canIgnore('{"custom":{"credentials":null}}')).toBe(false);
  });
});
