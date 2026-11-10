/**
 * Test harness for the email sign-in routes
 *
 * The email sign-in routes read everything from the request context: the
 * Cloudflare `env` (D1, the rate limiter, the vars, the `AUTH_EMAIL` service
 * binding) and the execution context whose `waitUntil` carries the background
 * send. This harness builds that context with a fake `AUTH_EMAIL` binding that
 * records every request, collects the promises handed to `waitUntil` so a test
 * can await them, stubs Turnstile's siteverify endpoint, and builds the POST
 * and GET requests the browser would send.
 *
 * @version v0.4.0
 */

import { env } from "cloudflare:test";
import { vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "~/context";
import type { SendResult } from "../../kit/email/types";
import type { AuthEmailRequest } from "../../app/email/types";

export const APP_ORIGIN = "https://ampl.tools";
export const TURNSTILE_PASS_SECRET = "1x0000000000000000000000000000000AA";
export const TURNSTILE_FAIL_SECRET = "2x0000000000000000000000000000000AA";
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface Harness {
  env: Env;
  sent: AuthEmailRequest[];
  send: ReturnType<typeof vi.fn>;
  waitUntilCalls: number;
  context(): RouterContextProvider;
  flush(): Promise<void>;
}

const live: Harness[] = [];

/**
 * Awaits the background work of every harness made since the last call. Call
 * it in afterEach: D1 writes still running after a test ends break the pool's
 * isolated storage.
 */
export async function flushAllHarnesses(): Promise<void> {
  for (const h of live.splice(0)) await h.flush();
}

/**
 * Builds a request context around the test env. `overrides` replaces env
 * entries (for example, to switch the feature flag off).
 */
export function makeHarness(
  overrides: Record<string, unknown> = {},
  sendResult: SendResult = { ok: true, id: "fake-resend-id" },
): Harness {
  const pending: Promise<unknown>[] = [];
  const sent: AuthEmailRequest[] = [];
  const send = vi.fn(async (req: AuthEmailRequest) => {
    sent.push(req);
    return sendResult;
  });
  const testEnv = { ...env, AUTH_EMAIL: { sendAuthEmail: send }, ...overrides } as unknown as Env;
  const harness: Harness = {
    env: testEnv,
    sent,
    send,
    waitUntilCalls: 0,
    context() {
      const ctx = new RouterContextProvider();
      ctx.set(cloudflareContext, {
        env: testEnv,
        ctx: {
          waitUntil: (p: Promise<unknown>) => {
            harness.waitUntilCalls += 1;
            pending.push(p);
          },
          passThroughOnException: () => {},
          props: {},
        } as unknown as ExecutionContext,
      });
      return ctx;
    },
    async flush() {
      while (pending.length > 0) {
        await Promise.all(pending.splice(0));
      }
    },
  };
  live.push(harness);
  return harness;
}

/**
 * Stubs global fetch so the siteverify call answers like Cloudflare's test
 * secrets: the pass secret succeeds for any non-empty response token, every
 * other secret fails. Any other outbound fetch fails the test.
 */
export function stubTurnstile() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== SITEVERIFY_URL) {
        throw new Error(`Unexpected fetch to ${url}`);
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        secret?: string;
        response?: string;
      };
      const success = body.secret === TURNSTILE_PASS_SECRET && Boolean(body.response);
      return Response.json({ success, "error-codes": success ? [] : ["invalid-input-response"] });
    },
  );
}

let ipCounter = 0;
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.77.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export interface PostOpts {
  ip?: string;
  /** Origin header; null leaves it out. Defaults to the app origin. */
  origin?: string | null;
  /** Sec-Fetch-Site header; null leaves it out. Defaults to same-origin. */
  site?: string | null;
  /** Request URL origin (for forged Host checks). Defaults to the app origin. */
  urlOrigin?: string;
  cookie?: string;
}

function postHeaders(opts: PostOpts): Headers {
  const headers = new Headers();
  headers.set("CF-Connecting-IP", opts.ip ?? uniqueIp());
  headers.set("Content-Type", "application/x-www-form-urlencoded");
  const origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
  if (origin !== null) headers.set("Origin", origin);
  const site = opts.site === undefined ? "same-origin" : opts.site;
  if (site !== null) headers.set("Sec-Fetch-Site", site);
  if (opts.cookie) headers.set("Cookie", opts.cookie);
  return headers;
}

export function emailRequest(
  fields: { email?: string; return_to?: string; turnstile?: string },
  opts: PostOpts = {},
): Request {
  const body = new URLSearchParams();
  if (fields.email !== undefined) body.set("email", fields.email);
  if (fields.return_to !== undefined) body.set("return_to", fields.return_to);
  body.set("cf-turnstile-response", fields.turnstile ?? "turnstile-test-token");
  const url = new URL("/auth/email/request", opts.urlOrigin ?? APP_ORIGIN);
  return new Request(url, { method: "POST", headers: postHeaders(opts), body });
}

export function verifyGet(token: string, opts: { urlOrigin?: string } = {}): Request {
  const url = new URL("/auth/email/verify", opts.urlOrigin ?? APP_ORIGIN);
  url.searchParams.set("token", token);
  return new Request(url, { headers: { "CF-Connecting-IP": uniqueIp() } });
}

export function verifyPost(
  fields: { token: string; name?: string },
  opts: PostOpts = {},
): Request {
  const body = new URLSearchParams();
  body.set("token", fields.token);
  if (fields.name !== undefined) body.set("name", fields.name);
  const url = new URL("/auth/email/verify", opts.urlOrigin ?? APP_ORIGIN);
  return new Request(url, { method: "POST", headers: postHeaders(opts), body });
}

export interface RouteResult {
  /** The Response, when the route returned or threw one. */
  response: Response | null;
  /** Loader/action data, when the route returned data. */
  data: any;
  status: number;
}

/**
 * Calls a loader or action and normalizes the outcome: a thrown or returned
 * Response, a `data()` result, or a plain object.
 */
export async function callRoute(
  fn: (args: any) => unknown,
  request: Request,
  context: RouterContextProvider,
): Promise<RouteResult> {
  let value: unknown;
  try {
    value = await fn({ request, context, params: {} });
  } catch (err) {
    if (err instanceof Response) {
      return { response: err, data: null, status: err.status };
    }
    throw err;
  }
  if (value instanceof Response) {
    return { response: value, data: null, status: value.status };
  }
  if (
    value &&
    typeof value === "object" &&
    (value as { type?: string }).type === "DataWithResponseInit"
  ) {
    const d = value as { data: unknown; init: ResponseInit | null };
    return { response: null, data: d.data, status: d.init?.status ?? 200 };
  }
  return { response: null, data: value, status: 200 };
}

/** Pulls the raw token out of a sign-in-link request. */
export function tokenFromMessage(req: AuthEmailRequest): string {
  if (req.kind !== "sign-in-link") throw new Error("not a sign-in link");
  const token = new URL(req.url).searchParams.get("token");
  if (!token) throw new Error("no token in sign-in link");
  return token;
}

export function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}
