/**
 * Email sign-in: use a link
 *
 * This file is where a sign-in link leads. The GET never uses the token: mail
 * scanners and link previewers fetch links, so a person who opens the link
 * sees only "Sign in as <email>" with a button (and, on a first sign-in, a
 * name field).
 * The POST from that button calls completeEmailSignIn, which uses the token,
 * finds or creates the account and creates a session identical to the GitHub
 * callback's; the POST then redirects through `safeReturnTo` to an absolute
 * URL on the APP_URL origin.
 *
 * Rules the POST enforces:
 *   - same-origin check and per-IP rate limit before anything else;
 *   - a first sign-in needs a name, checked before the token is used, so a
 *     missing name never burns the link;
 *   - the token is used with one atomic UPDATE, with the clock read at that
 *     moment, so of two concurrent POSTs only one gets a session;
 *   - an account with a github_id is never signed in by email: checked before
 *     the token is used, and the session insert itself is conditional on
 *     `github_id IS NULL`.
 *
 * Responses carry `Cache-Control: no-store`; every page in this app carries
 * `Referrer-Policy: no-referrer`, so the browser never sends the URL, and the token in it, in a
 * Referer header.
 *
 * @version v0.4.0
 */

import { data, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import { drizzle } from "drizzle-orm/d1";
import { Button, AuthError } from "@ampl/kit/ui";
import * as schema from "~/db/schema";
import { cloudflareContext } from "~/context";
import { sessionCookieHeader } from "~/sessions.server";
import {
  completeEmailSignIn,
  emailLoginConfig,
  findUserByEmail,
  isRawToken,
  isSameOriginPost,
  peekToken,
} from "~/lib/email-login.server";
import { withBase } from "~/lib/paths";
import type { Route } from "./+types/auth.email.verify";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in — AMPL" }, { name: "robots", content: "noindex" }];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

type VerifyState =
  | { state: "invalid" }
  | { state: "github" }
  | { state: "error"; error: string }
  | { state: "confirm"; email: string; needsName: boolean; token: string; error?: string };

function notFoundUnlessEnabled(env: Env) {
  const config = emailLoginConfig(env);
  if (!config.enabled) throw new Response("Not Found", { status: 404 });
  return config;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  notFoundUnlessEnabled(env);
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!isRawToken(token)) return { state: "invalid" } as VerifyState;

  const row = await peekToken(env.AUTH_DB, token);
  if (!row) return { state: "invalid" } as VerifyState;

  const db = drizzle(env.AUTH_DB, { schema });
  const user = await findUserByEmail(db, row.email);
  if (user && user.githubId !== null) return { state: "github" } as VerifyState;
  return {
    state: "confirm",
    email: row.email,
    needsName: !user || !user.name,
    token,
  } as VerifyState;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.get(cloudflareContext);
  const config = notFoundUnlessEnabled(env);
  if (!isSameOriginPost(request, config.appOrigin)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.AUTH_RATE_LIMITER.limit({ key: `email-verify:${ip}` });
  if (!success) {
    return data({ state: "error", error: "rate-limited" } as VerifyState, { status: 429 });
  }

  const form = await request.formData();
  const rawToken = form.get("token");
  const token = typeof rawToken === "string" ? rawToken : "";
  const result = await completeEmailSignIn(env, { token, name: form.get("name") });

  switch (result.kind) {
    case "invalid":
      return data({ state: "invalid" } as VerifyState, { status: 400 });
    case "github":
      return data({ state: "github" } as VerifyState, { status: 403 });
    case "name-required":
      return data(
        { state: "confirm", email: result.email, needsName: true, token, error: "name-required" } as VerifyState,
        { status: 400 },
      );
    case "ok": {
      const isSecure = new URL(request.url).protocol === "https:";
      throw redirect(result.destination, {
        headers: { "Set-Cookie": sessionCookieHeader(result.session.rawCookieValue, isSecure) },
      });
    }
  }
}

export default function VerifyPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const view = (actionData ?? loaderData) as VerifyState | undefined;

  if (!view || view.state === "invalid" || view.state === "github") {
    const github = view?.state === "github";
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-[30px] py-20">
        <div className="w-full max-w-[400px]">
          <h1 className="mb-4 font-title text-h4 text-fg-1">
            {t(github ? "emailLogin.verify.githubTitle" : "emailLogin.verify.invalidTitle")}
          </h1>
          <p className="mb-6 font-body text-body text-fg-2">
            {t(github ? "emailLogin.verify.githubBody" : "emailLogin.verify.invalidBody")}
          </p>
          <Button as="a" variant="fill" href={withBase("/login")}>
            {t("emailLogin.verify.toLogin")}
          </Button>
        </div>
      </main>
    );
  }

  if (view.state === "error") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-[30px] py-20">
        <div className="w-full max-w-[400px]">
          <AuthError message={t(`errors.${view.error}`, { defaultValue: t("unexpectedError") })} />
          <Button as="a" variant="text" href={withBase("/login")}>
            {t("emailLogin.verify.toLogin")}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-[30px] py-20">
      <div className="w-full max-w-[400px]">
        <h1 className="mb-4 break-words font-title text-h4 text-fg-1">
          {t("emailLogin.verify.title", { email: view.email })}
        </h1>
        <p className="mb-6 font-body text-body text-fg-2">{t("emailLogin.verify.body")}</p>
        {view.error && (
          <AuthError message={t(`errors.${view.error}`, { defaultValue: t("unexpectedError") })} />
        )}
        <form method="post" action={withBase("/email/verify")} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={view.token} />
          {view.needsName && (
            <label className="flex flex-col gap-1.5 font-body text-body text-fg-1">
              {t("emailLogin.verify.nameLabel")}
              <input
                type="text"
                name="name"
                required
                maxLength={80}
                autoComplete="name"
                className="rounded-[6px] border border-fg-3 bg-bg px-3 py-2 text-fg-1"
              />
              <span className="text-[13px] text-fg-2">{t("emailLogin.verify.nameHint")}</span>
            </label>
          )}
          <Button type="submit" variant="fill">
            {t("emailLogin.verify.submit")}
          </Button>
        </form>
      </div>
    </main>
  );
}
