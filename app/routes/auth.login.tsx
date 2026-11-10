/**
 * Login page
 *
 * This file renders the sign-in screen. When email sign-in is on, it shows an
 * email form first ("Email me a sign-in link", with the Turnstile widget),
 * then an "or" divider, then the "Continue with GitHub" button that sends the
 * user into the OAuth flow. When the user has been bounced back here after a
 * failed attempt, it reads the `error` code from the URL and surfaces a
 * matching translated message above both. Labels and error text are
 * bilingual, drawn from the shared common namespace, with a generic fallback
 * for any unrecognised error code.
 *
 * The loader only reads configuration: whether email sign-in is on, the
 * allowed domains (shown as a hint and interpolated into the domain error),
 * the public Turnstile site key, and the CSP nonce the Turnstile <script> tag
 * needs. The email form is shown only when the flag is on and a site key is
 * set. No database access.
 *
 * Applies the AMPL design language: kit Button + AuthError.
 *
 * Component behaviour:
 *   - The email form posts to withBase("/email/request") with a hidden
 *     return_to, so the deep-link destination survives the email round-trip.
 *   - Renders a kit Button ("Continue with GitHub") → withBase("/github"),
 *     forwarding any ?return_to= (percent-encoded) onto the start link so the
 *     deep-link destination survives the OAuth round-trip. Without this the
 *     param is dropped at the button and the user lands at /auth after login.
 *   - Reads ?error= from useSearchParams() and renders AuthError with the
 *     matching errors.* i18n key via the existing t(`errors.${errorCode}`,
 *     { defaultValue }) safe pattern.
 *   - Bilingual via the common namespace (login.* + emailLogin.* + errors.*).
 *
 * @version v0.4.0
 */

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, AuthError } from "@ampl/kit/ui";
import { withBase } from "~/lib/paths";
import { cloudflareContext } from "~/context";
import { nonceContext } from "~/middleware/security";
import { emailLoginConfig, TURNSTILE_ACTION } from "~/lib/email-login.server";
import type { Route } from "./+types/auth.login";

// Explicit rendering: with implicit rendering the script fills the widget
// before React hydrates, and hydration then removes what it filled.
const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(el: HTMLElement, options: { sitekey: string; action: string }): string;
  remove(widgetId: string): void;
}

/**
 * The Turnstile widget, rendered after hydration. It adds the hidden
 * `cf-turnstile-response` field to the form it sits in.
 */
function TurnstileWidget({ siteKey, action }: { siteKey: string; action: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widgetId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    const mount = () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api && ref.current) {
        widgetId = api.render(ref.current, { sitekey: siteKey, action });
        return;
      }
      // The script is loaded with async; wait for it for up to 30 seconds.
      if (tries++ < 150) timer = setTimeout(mount, 200);
    };
    mount();
    return () => {
      if (timer) clearTimeout(timer);
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api && widgetId) api.remove(widgetId);
    };
  }, [siteKey, action]);
  return <div ref={ref} data-sitekey={siteKey} data-action={action} />;
}

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in — AMPL" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const config = emailLoginConfig(env);
  return {
    emailEnabled: config.enabled && config.turnstileSiteKey !== "",
    domains: config.domains,
    turnstileSiteKey: config.turnstileSiteKey,
    turnstileAction: TURNSTILE_ACTION,
    nonce: context.get(nonceContext),
  };
}

type LoginData = Awaited<ReturnType<typeof loader>>;

export default function LoginPage({ loaderData }: { loaderData?: LoginData }) {
  const { t } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get("error");
  const domains = (loaderData?.domains ?? []).join(", ");

  // Forward the deep-link destination into the OAuth start link. Without this
  // the param is dropped at the button, so auth.github sets an empty
  // github_return_to cookie and the callback lands the user at /auth instead
  // of where they were heading. Encoded so the path survives the round-trip.
  const returnTo = searchParams.get("return_to");
  const githubHref = withBase(
    "/github" + (returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ""),
  );

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-[30px] py-20">
      <div className="w-full max-w-[400px]">
        <h1 className="mb-6 font-title text-h4 text-fg-1">{t("login.title")}</h1>

        {errorCode && (
          <AuthError
            message={t(`errors.${errorCode}`, { defaultValue: t("unexpectedError"), domains })}
          />
        )}

        {loaderData?.emailEnabled && (
          <>
            <form
              method="post"
              action={withBase("/email/request")}
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="return_to" value={returnTo ?? ""} />
              <label className="flex flex-col gap-1.5 font-body text-body text-fg-1">
                {t("emailLogin.label")}
                <input
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  inputMode="email"
                  placeholder={t("emailLogin.placeholder", {
                    domain: loaderData.domains[0] ?? "ucsb.edu",
                  })}
                  className="rounded-[6px] border border-fg-3 bg-bg px-3 py-2 text-fg-1"
                />
              </label>
              <p className="font-body text-[13px] text-fg-2">
                {t("emailLogin.hint", { domains })}
              </p>
              <TurnstileWidget
                siteKey={loaderData.turnstileSiteKey}
                action={loaderData.turnstileAction}
              />
              <Button type="submit" variant="fill">
                {t("emailLogin.submit")}
              </Button>
            </form>
            <script src={TURNSTILE_SCRIPT} async defer nonce={loaderData.nonce} />
            <div className="my-6 flex items-center gap-3 font-body text-[13px] text-fg-2">
              <span className="h-px flex-1 bg-fg-3" aria-hidden="true" />
              <span>{t("login.or")}</span>
              <span className="h-px flex-1 bg-fg-3" aria-hidden="true" />
            </div>
          </>
        )}

        <Button as="a" variant="dark" href={githubHref}>
          {/* Inline Octocat — official GitHub mark, white fill, no runtime dependency */}
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 98 96"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
              fill="#ffffff"
            />
          </svg>
          {t("login.continueWithGithub")}
        </Button>
      </div>
    </main>
  );
}
