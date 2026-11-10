/**
 * send() recipient parsing tests
 *
 * `to` may be a bare address or a display form such as `Reader <reader@x>`.
 * Suppression lookup, the send log, idempotency and quota all use the bare,
 * normalized address, so a suppression recorded for `reader@x` blocks
 * `Reader <reader@x>` and the reverse. A `to` holding more than one address
 * or a CR/LF is refused before anything is written.
 *
 * @version v0.4.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getEmailDb, schema } from "../helpers/email-db";
import { parseRecipient } from "../../app/email/lib/address";
import type { SendMessage } from "../../app/email/types";

let resendTo: string[] = [];
function installResendFake() {
  resendTo = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.resend.com/emails") {
        resendTo.push((JSON.parse(String(init?.body ?? "{}")) as { to: string }).to);
        return Response.json({ id: `resend-${resendTo.length}` });
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    }),
  );
}

async function worker() {
  const mod = await import("../../workers/email");
  return new mod.default({} as unknown as ExecutionContext, env);
}

const base: SendMessage = { to: "", subject: "[Calamus] Hi", html: "<p>hi</p>", text: "hi", tool: "calamus" };

async function suppress(address: string) {
  await getEmailDb().insert(schema.suppressions).values({
    address,
    reason: "unsubscribe",
    source: "user_request",
    createdAt: Date.now(),
  });
}

describe("parseRecipient", () => {
  it.each([
    ["reader@ucsb.edu", "reader@ucsb.edu"],
    ["  Reader@UCSB.edu  ", "reader@ucsb.edu"],
    ["Reader <reader@ucsb.edu>", "reader@ucsb.edu"],
    ["\"Doe, Jane\" <Jane@UCSB.edu>", "jane@ucsb.edu"],
    ["\"A \\\"quoted\\\" name\" <a@ucsb.edu>", "a@ucsb.edu"],
    ["<b@ucsb.edu>", "b@ucsb.edu"],
  ])("%j → %s", (input, expected) => {
    expect(parseRecipient(input)).toBe(expected);
  });

  it.each([
    "a@ucsb.edu, b@ucsb.edu",
    "a@ucsb.edu; b@ucsb.edu",
    "A <a@ucsb.edu>, B <b@ucsb.edu>",
    "a@ucsb.edu\r\nBcc: x@evil.example",
    "Reader <reader@ucsb.edu>\nBcc: x@evil.example",
    "Reader <reader@ucsb.edu> extra",
    "not an address",
    "",
    "a@@ucsb.edu",
  ])("refuses %j", (input) => {
    expect(parseRecipient(input)).toBeNull();
  });
});

describe("send() uses the bare address", () => {
  beforeEach(installResendFake);
  afterEach(() => vi.unstubAllGlobals());

  it("a suppression for reader@ blocks 'Reader <reader@>'", async () => {
    await suppress("reader@ucsb.edu");
    const result = await (await worker()).send({ ...base, to: "Reader <Reader@ucsb.edu>" });
    expect(result).toEqual({ ok: false, reason: "suppressed" });
    expect(resendTo).toHaveLength(0);
    const row = await getEmailDb().select().from(schema.sends).where(eq(schema.sends.status, "suppressed")).get();
    expect(row?.recipient).toBe("reader@ucsb.edu");
  });

  it("a send to 'Reader <reader@>' is logged under the bare address, so a later suppression for it is found", async () => {
    const first = await (await worker()).send({ ...base, to: "\"Reader, R.\" <reader2@ucsb.edu>" });
    expect(first.ok).toBe(true);
    const row = await getEmailDb().select().from(schema.sends).where(eq(schema.sends.resendId, "resend-1")).get();
    expect(row?.recipient).toBe("reader2@ucsb.edu");

    await suppress("reader2@ucsb.edu");
    const second = await (await worker()).send({ ...base, to: "reader2@ucsb.edu" });
    expect(second).toEqual({ ok: false, reason: "suppressed" });
  });

  it("the unsubscribe link is signed for the bare address", async () => {
    const { verifyUnsubToken } = await import("../../app/email/lib/unsub-token");
    vi.unstubAllGlobals();
    let payload: { headers?: Record<string, string> } = {};
    vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body ?? "{}"));
      return Response.json({ id: "resend-x" });
    }));
    await (await worker()).send({ ...base, to: "Reader <reader3@ucsb.edu>" });
    const token = decodeURIComponent(payload.headers!["List-Unsubscribe"].match(/token=([^>]+)>/)![1]);
    expect(await verifyUnsubToken(token, env.UNSUB_HMAC_SECRET)).toBe("reader3@ucsb.edu");
  });

  it.each(["a@ucsb.edu, b@ucsb.edu", "a@ucsb.edu\r\nBcc: x@evil.example"])(
    "refuses %j before writing anything",
    async (to) => {
      const before = await getEmailDb().select().from(schema.sends).all();
      const result = await (await worker()).send({ ...base, to });
      expect(result).toEqual({ ok: false, reason: "error", detail: "invalid_recipient" });
      expect(resendTo).toHaveLength(0);
      expect((await getEmailDb().select().from(schema.sends).all()).length).toBe(before.length);
    },
  );
});
