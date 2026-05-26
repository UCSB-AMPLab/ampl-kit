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

        <Button as="a" variant="fill" href={withBase("/github")}>
          {t("login.continueWithGithub")}
        </Button>
      </div>
    </main>
  );
}
