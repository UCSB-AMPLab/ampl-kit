/**
 * Login page
 *
 * This file renders the sign-in screen. It shows a single "Continue with
 * GitHub" button that sends the user into the OAuth flow, and — when the user
 * has been bounced back here after a failed attempt — it reads the `error`
 * code from the URL and surfaces a matching translated message above the
 * button. Both the labels and the error text are bilingual, drawn from the
 * shared common namespace, with a generic fallback for any unrecognised error
 * code. It is presentation only: no loader, no database access.
 *
 * Applies the AMPL design language: kit Button + AuthError.
 *
 * Component behaviour:
 *   - Renders a kit Button ("Continue with GitHub") → withBase("/github").
 *   - Reads ?error= from useSearchParams() and renders AuthError with the
 *     matching errors.* i18n key via the existing t(`errors.${errorCode}`,
 *     { defaultValue }) safe pattern.
 *   - Bilingual via the common namespace (login.* + errors.*).
 *
 * @version v0.1.0
 */

import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, AuthError } from "@ampl/kit/ui";
import { withBase } from "~/lib/paths";
import type { Route } from "./+types/auth.login";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in — AMPL" }];
}

export default function LoginPage() {
  const { t } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get("error");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-[30px] py-20">
      <div className="w-full max-w-[400px]">
        <h1 className="mb-6 font-title text-h4 text-fg-1">{t("login.title")}</h1>

        {errorCode && (
          <AuthError
            message={t(`errors.${errorCode}`, { defaultValue: t("unexpectedError") })}
          />
        )}

        <Button as="a" variant="dark" href={withBase("/github")}>
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
