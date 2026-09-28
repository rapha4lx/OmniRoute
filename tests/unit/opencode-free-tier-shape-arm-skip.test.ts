/**
 * #14313 follow-up — the free-tier pause must not be armed by a request that
 * already carried the client contract.
 *
 * The pause armed at `chatCore.ts` on any `noauth` free-tier refusal, which is
 * provider-global: a single refusal on a request that DID carry tools + stream +
 * session/UA identity blacked out every later request of that provider for the
 * whole TTL, including the native client whose own good shape would have been
 * served. Measured on 2026-09-28 — `free-tier refusal on own tools [bash]` armed
 * the pause and the following native request 503'd.
 *
 * Option A of the spec keeps the pause for shapes that did NOT already carry the
 * contract (that is the tight-re-pick loop it exists to bound, #14405) and leaves
 * the per-request retry to the requests that did carry it.
 */
// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-shape-arm-skip-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-shape-arm-skip-secret";

const core = await import("../../src/lib/db/core.ts");
const auth = await import("../../src/sse/services/auth.ts");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.ts");
const { isOpencodeFreeTierSkipped, clearOpencodeFreeTierSkips } =
  await import("../../open-sse/services/opencodeFreeTierSkip.ts");

const originalFetch = globalThis.fetch;
const REFUSAL_BODY = JSON.stringify({
  type: "error",
  error: {
    type: "FreeTierError",
    message:
      "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode",
  },
});
const noopLog = { debug() {}, info() {}, warn() {}, error() {} };

test.after(() => {
  globalThis.fetch = originalFetch;
  clearOpencodeFreeTierSkips();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test.beforeEach(() => {
  clearOpencodeFreeTierSkips();
});

/** One refused noauth request; returns whether the provider-global pause is armed after it. */
async function pauseArmedAfterRefusal({ tools, stream, headers }) {
  const credentials = await auth.getProviderCredentials("opencode", null, null, "big-pickle");
  assert.equal(credentials?.connectionId, "noauth");

  globalThis.fetch = async () =>
    new Response(REFUSAL_BODY, {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  try {
    const requestBody = {
      model: "big-pickle",
      messages: [{ role: "user", content: "hi" }],
      ...(stream === undefined ? {} : { stream }),
      ...(tools ? { tools } : {}),
    };
    await handleChatCore({
      body: structuredClone(requestBody),
      modelInfo: { provider: "opencode", model: "big-pickle", extendedContext: false },
      credentials,
      log: noopLog,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: structuredClone(requestBody),
        headers: new Headers(headers ?? {}),
      },
      connectionId: credentials.connectionId ?? null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return isOpencodeFreeTierSkipped("opencode");
}

const CLIENT_TOOLS = [{ type: "function", function: { name: "bash" } }];
/** A body with no client tools at all — the thin/synthetic shape. */
const SESSION_HEADERS = { "x-opencode-session": "ses_0123456789abcdefABCDEFGHIJKL" };
const CLI_UA_HEADERS = { "user-agent": "opencode/1.18.31" };

test("a refusal on a request that already carried the contract does NOT arm the pause", async () => {
  const armed = await pauseArmedAfterRefusal({
    tools: CLIENT_TOOLS,
    stream: true,
    headers: SESSION_HEADERS,
  });
  assert.equal(
    armed,
    false,
    "a good-shape refusal must not pause the provider — that blacked out the native client"
  );
});

test("the OpenCode CLI User-Agent alone is enough identity, beside the client's own tools", async () => {
  const armed = await pauseArmedAfterRefusal({
    tools: CLIENT_TOOLS,
    stream: true,
    headers: CLI_UA_HEADERS,
  });
  assert.equal(armed, false);
});

test("a thin shape (no client tools) still arms the pause — the re-pick loop it bounds", async () => {
  const armed = await pauseArmedAfterRefusal({ stream: true, headers: SESSION_HEADERS });
  assert.equal(armed, true);
});

test("client tools without a stream do not make a complete shape — the pause still arms", async () => {
  const armed = await pauseArmedAfterRefusal({
    tools: CLIENT_TOOLS,
    stream: false,
    headers: SESSION_HEADERS,
  });
  assert.equal(armed, true);
});

test("tools + stream without any session/UA identity still arms the pause", async () => {
  const armed = await pauseArmedAfterRefusal({ tools: CLIENT_TOOLS, stream: true, headers: {} });
  assert.equal(armed, true);
});

test("the OmniRoute placeholder tool is not the client's own tools", async () => {
  const armed = await pauseArmedAfterRefusal({
    tools: [{ type: "function", function: { name: "_noop" } }],
    stream: true,
    headers: SESSION_HEADERS,
  });
  assert.equal(armed, true, "_noop is OmniRoute's own synthesis, never evidence of a client shape");
});
