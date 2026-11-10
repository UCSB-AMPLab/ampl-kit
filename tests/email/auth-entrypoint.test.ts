/**
 * AuthEmail entrypoint tests
 *
 * ampl-auth sends sign-in mail through the `AuthEmail` entrypoint, not the
 * general `send()`. The entrypoint accepts only a recipient, a locale, a kind
 * ("sign-in-link" or "github-notice"), a URL and a lifetime in minutes, and
 * renders one of two fixed templates itself. The URL must be https and on the
 * auth origin configured in AUTH_APP_URL, at the path the kind requires. Only
 * this path skips unsubscribe-only suppressions and leaves out the
 * List-Unsubscribe header and the unsubscribe link; bounces and complaints
 * still block it. The general `send()` ignores any extra field a caller adds,
 * so no caller can use it to get past an unsubscribe.
 *
 * @version v0.4.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { getEmailDb, schema } from "../helpers/email-db";
import type { AuthEmailRequest, SendMessage } from "../../app/email/types";

type ResendPayload = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> };
let resendCalls: ResendPayload[] = [];

function installResendFake() {
  resendCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.resend.com/emails") {
        resendCalls.push(JSON.parse(String(init?.body ?? "{}")) as ResendPayload);
        return Response.json({ id: "resend-auth-id" });
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    }),
  );
}

const TOKEN = "a".repeat(64);
const LINK: AuthEmailRequest = {
  to: "person@ucsb.edu",
  locale: "en",
  kind: "sign-in-link",
  url: `https://ampl.tools/auth/email/verify?token=${TOKEN}`,
  minutes: 15,
};
const NOTICE: AuthEmailRequest = {
  to: "person@ucsb.edu",
  locale: "es",
  kind: "github-notice",
  url: "https://ampl.tools/auth/login",
  minutes: 15,
};

async function authEmail() {
  const mod = await import("../../workers/email");
  return new mod.AuthEmail({} as unknown as ExecutionContext, env);
}
async function general() {
  const mod = await import("../../workers/email");
  return new mod.default({} as unknown as ExecutionContext, env);
}
async function suppress(address: string, reason: "bounce" | "complaint" | "unsubscribe") {
  await getEmailDb().insert(schema.suppressions).values({
    address,
    reason,
    source: reason === "unsubscribe" ? "user_request" : "resend_webhook",
    createdAt: Date.now(),
  });
}

describe("AuthEmail.sendAuthEmail", () => {
  beforeEach(installResendFake);
  afterEach(() => vi.unstubAllGlobals());

  it("renders the sign-in template with the link and no unsubscribe header or link", async () => {
    const result = await (await authEmail()).sendAuthEmail({ ...LINK });
    expect(result).toEqual({ ok: true, id: "resend-auth-id" });
    const p = resendCalls[0];
    expect(p.to).toBe("person@ucsb.edu");
    expect(p.subject).toBe("[AMPL] Your sign-in link");
    expect(p.text).toContain(LINK.url);
    expect(p.text).toContain("15 minutes");
    expect(p.headers?.["List-Unsubscribe"]).toBeUndefined();
    expect(p.html).not.toContain("/email/unsubscribe");
    expect(p.text).not.toContain("/email/unsubscribe");
    expect(p.html).toContain("<!--ampl-footer-->");
  });

  it("renders the GitHub notice in Spanish with the reviewed wording", async () => {
    await (await authEmail()).sendAuthEmail({ ...NOTICE });
    const p = resendCalls[0];
    expect(p.subject).toBe("[AMPL] Inicia sesión con GitHub");
    expect(p.text).toContain("No enviamos ninguno, porque a tu cuenta de AMPL se entra con GitHub.");
    expect(p.text).toContain("https://ampl.tools/auth/login");
    expect(p.html).not.toMatch(/Darte de baja/);
  });

  it("delivers despite an unsubscribe suppression, matched case-insensitively", async () => {
    await suppress("person@ucsb.edu", "unsubscribe");
    expect((await (await authEmail()).sendAuthEmail({ ...LINK, to: "Person@UCSB.edu" })).ok).toBe(true);
  });

  it.each(["bounce", "complaint"] as const)("honors a %s suppression", async (reason) => {
    await suppress("person@ucsb.edu", reason);
    expect(await (await authEmail()).sendAuthEmail({ ...LINK })).toEqual({ ok: false, reason: "suppressed" });
    expect(resendCalls).toHaveLength(0);
  });

  it("logs the send under tool 'auth'", async () => {
    await (await authEmail()).sendAuthEmail({ ...LINK });
    const row = await getEmailDb().select().from(schema.sends).where(eq(schema.sends.resendId, "resend-auth-id")).get();
    expect(row?.tool).toBe("auth");
  });

  const refused: Array<[string, Partial<AuthEmailRequest> & Record<string, unknown>]> = [
    ["an off-origin url", { url: `https://evil.example/auth/email/verify?token=${TOKEN}` }],
    ["a look-alike origin", { url: `https://ampl.tools.evil.example/auth/email/verify?token=${TOKEN}` }],
    ["an http url", { url: `http://ampl.tools/auth/email/verify?token=${TOKEN}` }],
    ["a javascript: url", { url: "javascript:alert(1)" }],
    ["a wrong path for the kind", { url: `https://ampl.tools/paleography?token=${TOKEN}` }],
    ["a link without a token", { url: "https://ampl.tools/auth/email/verify" }],
    ["a link with extra parameters", { url: `https://ampl.tools/auth/email/verify?token=${TOKEN}&next=//evil` }],
    ["a userinfo url", { url: `https://evil@ampl.tools/auth/email/verify?token=${TOKEN}` }],
    ["an unknown kind", { kind: "newsletter" as AuthEmailRequest["kind"] }],
    ["a malformed recipient", { to: "a@b@c" }],
    ["two recipients", { to: ["a@ucsb.edu", "b@ucsb.edu"] as unknown as string }],
    ["a bad lifetime", { minutes: 0 }],
    ["an unknown locale", { locale: "fr" as AuthEmailRequest["locale"] }],
    ["a url with a newline that normalizes to the right path", {
      url: `https://ampl.tools/\nhttps://evil.example/\n../../../auth/email/verify?token=${TOKEN}`,
    }],
    ["a url with a tab", { url: `https://ampl.tools/auth/email/verify?token=${TOKEN}\t` }],
    ["a url with surrounding spaces", { url: ` https://ampl.tools/auth/email/verify?token=${TOKEN}` }],
    ["a recipient with a newline", { to: "person@ucsb.edu\nBcc: x@evil.example" }],
    ["a recipient with surrounding whitespace", { to: " person@ucsb.edu " }],
  ];
  for (const [label, patch] of refused) {
    it(`refuses ${label}`, async () => {
      const result = await (await authEmail()).sendAuthEmail({ ...LINK, ...patch } as AuthEmailRequest);
      expect(result).toEqual({ ok: false, reason: "error", detail: "invalid_auth_request" });
      expect(resendCalls).toHaveLength(0);
    });
  }

  it("refuses a notice url with newlines, and never mails a host other than the auth origin", async () => {
    const sneaky = "https://ampl.tools/\nhttps://evil.example/\n../../../auth/login";
    // The URL parser drops the newlines and resolves this to /auth/login.
    expect(new URL(sneaky).href).toBe("https://ampl.tools/auth/login");
    const result = await (await authEmail()).sendAuthEmail({ ...NOTICE, url: sneaky });
    expect(result).toEqual({ ok: false, reason: "error", detail: "invalid_auth_request" });
    expect(resendCalls).toHaveLength(0);
  });

  it("renders the canonical href of the URL, and no other host, in both bodies", async () => {
    // Percent-encoding differences are canonicalized by the parser.
    await (await authEmail()).sendAuthEmail({ ...NOTICE, url: "https://AMPL.tools/auth/login" });
    const p = resendCalls[0];
    for (const body of [p.text, p.html]) {
      const hosts = [...body.matchAll(/https?:\/\/([^/\s"'<>]+)/gi)].map((m) => m[1].toLowerCase());
      const offOrigin = hosts.filter((h) => h !== "ampl.tools" && h !== "ampl.clair.ucsb.edu");
      expect(offOrigin).toEqual([]);
    }
    expect(p.text).toContain("https://ampl.tools/auth/login");
    expect(p.text).not.toContain("AMPL.tools");
  });

  it("refuses a notice url that is not the login page", async () => {
    const result = await (await authEmail()).sendAuthEmail({ ...NOTICE, url: LINK.url });
    expect(result.ok).toBe(false);
  });

  it("ignores caller-supplied subject or body fields", async () => {
    await (await authEmail()).sendAuthEmail({
      ...LINK,
      subject: "Win a prize",
      html: "<a href='https://evil.example'>x</a>",
      text: "evil",
    } as unknown as AuthEmailRequest);
    expect(resendCalls[0].subject).toBe("[AMPL] Your sign-in link");
    expect(resendCalls[0].html).not.toContain("evil.example");
  });
});

describe("general send() cannot reach the auth path", () => {
  beforeEach(installResendFake);
  afterEach(() => vi.unstubAllGlobals());

  const base: SendMessage = {
    to: "reader@ucsb.edu",
    subject: "[Calamus] Hi",
    html: "<p>hi</p>",
    text: "hi",
    tool: "calamus",
  };

  for (const extra of [{ category: "auth" }, { kind: "sign-in-link" }, { accountAccess: true }, { tool: "auth", category: "auth" }]) {
    it(`an unsubscribe still blocks send() with ${JSON.stringify(extra)}`, async () => {
      await suppress("reader@ucsb.edu", "unsubscribe");
      const result = await (await general()).send({ ...base, ...extra } as unknown as SendMessage);
      expect(result).toEqual({ ok: false, reason: "suppressed" });
      expect(resendCalls).toHaveLength(0);
    });
  }

  it("send() with category auth still stamps List-Unsubscribe", async () => {
    await (await general()).send({ ...base, category: "auth" } as unknown as SendMessage);
    expect(resendCalls[0].headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/ampl\.tools\/email\/unsubscribe/);
    expect(resendCalls[0].html).toContain("/email/unsubscribe");
  });
});
