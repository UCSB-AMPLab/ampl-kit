/**
 * Inbound forwarding tests — handleWebhook(email.received)
 *
 * Exercises the email.received branch of handleWebhook end-to-end with a
 * properly Svix-signed payload. The global `fetch` is stubbed to intercept both
 * Resend calls the forward path makes — the Receiving API GET
 * (`/emails/receiving/{id}`, returns the inbound body) and the send POST
 * (`/emails`, the forward) — so NO real network call is made.
 *
 * Cases covered:
 *   (a) recipient in the forward map → a forward send is attempted with the
 *       kit verified From, the mapped destination, Reply-To = original sender,
 *       a "Fwd:" subject, and NO List-Unsubscribe headers.
 *   (b) recipient NOT in the map → no body fetch, no forward, 200 (drop).
 *   (c) loop sender (@ampl.tools) → no forward, 200.
 *   (d) automated mail (Auto-Submitted header) → no forward, 200.
 *   (e) recipient in map but RESEND_API_KEY unset → 500 (Resend retries).
 *   (f) INBOUND_FORWARDS unset → nothing is forwarded, 200.
 *
 * The forward map is supplied through the `INBOUND_FORWARDS` secret. Each test
 * builds its env with `withForwards`, using example addresses only.
 *
 * Run under vitest.email.config.ts (EMAIL_DB + drizzle-email migrations).
 *
 * @version v0.4.0
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { handleWebhook } from "../../app/email/routes/webhook";
import { FORWARD_FROM } from "../../app/email/lib/forward-map";

const FORWARDS = JSON.stringify({
  "hello@ampl.tools": "maintainer@example.org",
  "privacy@ampl.tools": "maintainer@example.org",
});

/** Env carrying the given INBOUND_FORWARDS secret (undefined removes it). */
function withForwards(forwards: string | undefined, extra: object = {}): Env {
  return { ...env, INBOUND_FORWARDS: forwards, ...extra } as unknown as Env;
}

const RECEIVING_PREFIX = "https://api.resend.com/emails/receiving/";
const SEND_URL = "https://api.resend.com/emails";

// ---------------------------------------------------------------------------
// Svix signing helper (mirrors webhook.test.ts)
// ---------------------------------------------------------------------------

async function signSvix(
  id: string,
  timestamp: string,
  body: string,
  secret: string,
): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secret.replace("whsec_", "")), (c) =>
    c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function makeReceivedRequest(body: string, ip: string): Promise<Request> {
  const id = "msg_test_" + Math.random().toString(36).slice(2);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = await signSvix(id, timestamp, body, env.RESEND_WEBHOOK_SECRET);
  return new Request("https://ampl.tools/email/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": sig,
      "CF-Connecting-IP": ip,
    },
    body,
  });
}

interface ReceivedFixture {
  from?: string;
  to?: string[];
  subject?: string;
  html?: string | null;
  text?: string | null;
  headers?: Record<string, string> | Array<{ name: string; value: string }>;
  date?: string;
}

function makeReceivedPayload(opts: {
  to: string[] | string;
  from: string;
  subject?: string;
  email_id?: string;
}): string {
  return JSON.stringify({
    type: "email.received",
    created_at: "2026-06-29T12:00:00.000Z",
    data: {
      email_id: opts.email_id ?? "inbound-001",
      to: opts.to,
      from: opts.from,
      subject: opts.subject ?? "Hello there",
    },
  });
}

// ---------------------------------------------------------------------------
// fetch fake — captures send POSTs and serves a configurable inbound body
// ---------------------------------------------------------------------------

interface SendCall {
  url: string;
  body: Record<string, unknown>;
}

let sendCalls: SendCall[] = [];
let receivingGets: string[] = [];

function installFetchFake(inbound: ReceivedFixture) {
  sendCalls = [];
  receivingGets = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith(RECEIVING_PREFIX)) {
        receivingGets.push(url);
        return new Response(JSON.stringify(inbound), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === SEND_URL) {
        const body = JSON.parse(
          (init?.body as string) ?? "{}",
        ) as Record<string, unknown>;
        sendCalls.push({ url, body });
        return new Response(JSON.stringify({ id: "fwd-fake-id-001" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleWebhook — email.received forwarding", () => {
  // (a) recipient in the map → forward send attempted
  it("forwards an allowlisted recipient with the right From/To/Reply-To and no unsubscribe headers", async () => {
    installFetchFake({
      from: "Jane Doe <jane@example.com>",
      to: ["hello@ampl.tools"],
      subject: "Question about Calamus",
      text: "Hi, I have a question.",
      html: "<p>Hi, I have a question.</p>",
      headers: { Date: "Mon, 29 Jun 2026 12:00:00 +0000" },
    });

    const body = makeReceivedPayload({
      to: ["hello@ampl.tools"],
      from: "Jane Doe <jane@example.com>",
      subject: "Question about Calamus",
      email_id: "inbound-aaa",
    });
    const res = await handleWebhook(
      await makeReceivedRequest(body, "10.20.1.1"),
      withForwards(FORWARDS),
    );

    expect(res.status).toBe(200);

    // Body was fetched from the Receiving API for the right id.
    expect(receivingGets).toHaveLength(1);
    expect(receivingGets[0]).toBe(`${RECEIVING_PREFIX}inbound-aaa`);

    // Exactly one forward send.
    expect(sendCalls).toHaveLength(1);
    const sent = sendCalls[0].body;
    expect(sent.from).toBe(FORWARD_FROM);
    expect(sent.to).toBe("maintainer@example.org");
    expect(sent.reply_to).toBe("Jane Doe <jane@example.com>");
    expect(sent.subject).toBe("Fwd: Question about Calamus");
    // No marketing unsubscribe headers on a forward.
    expect(sent.headers).toBeUndefined();
    // Original body carried through; forwarded-message note present.
    expect(String(sent.text)).toContain("Hi, I have a question.");
    expect(String(sent.text)).toContain("Forwarded message");
    expect(String(sent.html)).toContain("<p>Hi, I have a question.</p>");
  });

  // (b) recipient NOT in the map → no forward, 200, no body fetch
  it("drops a non-allowlisted recipient with a 200 and no forward", async () => {
    installFetchFake({ from: "x@example.com", text: "hi" });

    const body = makeReceivedPayload({
      to: ["random@ampl.tools"],
      from: "x@example.com",
    });
    const res = await handleWebhook(
      await makeReceivedRequest(body, "10.20.2.1"),
      withForwards(FORWARDS),
    );

    expect(res.status).toBe(200);
    expect(receivingGets).toHaveLength(0); // dropped before fetching the body
    expect(sendCalls).toHaveLength(0);
  });

  // (c) loop sender (@ampl.tools) → no forward, 200
  it("does not forward mail whose sender is an @ampl.tools address (loop guard)", async () => {
    installFetchFake({ from: "noreply@ampl.tools", text: "loop" });

    const body = makeReceivedPayload({
      to: ["hello@ampl.tools"],
      from: "AMPL <noreply@ampl.tools>",
    });
    const res = await handleWebhook(
      await makeReceivedRequest(body, "10.20.3.1"),
      withForwards(FORWARDS),
    );

    expect(res.status).toBe(200);
    expect(sendCalls).toHaveLength(0);
  });

  // (d) automated mail (Auto-Submitted) → no forward, 200
  it("does not forward auto-submitted mail (loop guard)", async () => {
    installFetchFake({
      from: "robot@example.com",
      to: ["hello@ampl.tools"],
      subject: "Out of office",
      text: "I am away.",
      headers: { "Auto-Submitted": "auto-replied" },
    });

    const body = makeReceivedPayload({
      to: ["hello@ampl.tools"],
      from: "robot@example.com",
      email_id: "inbound-ddd",
    });
    const res = await handleWebhook(
      await makeReceivedRequest(body, "10.20.4.1"),
      withForwards(FORWARDS),
    );

    expect(res.status).toBe(200);
    expect(receivingGets).toHaveLength(1); // header check needs the body
    expect(sendCalls).toHaveLength(0);
  });

  // (e) allowlisted recipient but missing API key → 500 (Resend retries)
  it("fails closed with 500 when RESEND_API_KEY is unset and a forward is needed", async () => {
    installFetchFake({ from: "jane@example.com", text: "hi" });

    const noKeyEnv = withForwards(FORWARDS, { RESEND_API_KEY: undefined });

    const body = makeReceivedPayload({
      to: ["privacy@ampl.tools"],
      from: "jane@example.com",
    });
    const res = await handleWebhook(
      await makeReceivedRequest(body, "10.20.5.1"),
      noKeyEnv,
    );

    expect(res.status).toBe(500);
    expect(sendCalls).toHaveLength(0);
  });

  // (f) secret missing or unparseable → nothing forwarded, one error logged
  it.each([
    ["missing", undefined],
    ["unparseable", "{not json"],
  ])("forwards nothing when INBOUND_FORWARDS is %s", async (_label, value) => {
    installFetchFake({ from: "jane@example.com", text: "hi" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const body = makeReceivedPayload({
      to: ["hello@ampl.tools"],
      from: "jane@example.com",
    });
    const res = await handleWebhook(
      await makeReceivedRequest(body, "10.20.6.1"),
      withForwards(value),
    );

    expect(res.status).toBe(200);
    expect(receivingGets).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
    expect(errors).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain("hello@ampl.tools");
    expect(logged).not.toContain("example.org");
    errors.mockRestore();
  });
});
