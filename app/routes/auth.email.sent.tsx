/**
 * Email sign-in: "check your email"
 *
 * This file renders the page a person is sent to after asking for a sign-in
 * link with any allowed address, whether or not the address belongs to an
 * account. It says
 * nothing about the address, carries no data, and links back to the sign-in
 * page.
 *
 * @version v0.4.0
 */

import { useTranslation } from "react-i18next";
import { Button } from "@ampl/kit/ui";
import { withBase } from "~/lib/paths";
import { TOKEN_TTL_MINUTES } from "~/lib/email-login";
import type { Route } from "./+types/auth.email.sent";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Check your email — AMPL" }];
}

const MINUTES = String(TOKEN_TTL_MINUTES);

export default function EmailSentPage() {
  const { t } = useTranslation("common");
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-[30px] py-20">
      <div className="w-full max-w-[400px]">
        <h1 className="mb-4 font-title text-h4 text-fg-1">{t("emailLogin.sent.title")}</h1>
        <p className="mb-4 font-body text-body text-fg-2">{t("emailLogin.sent.body")}</p>
        <p className="mb-6 font-body text-body text-fg-2">
          {t("emailLogin.sent.expiry", { minutes: MINUTES })}
        </p>
        <Button as="a" variant="text" href={withBase("/login")}>
          {t("emailLogin.sent.back")}
        </Button>
      </div>
    </main>
  );
}
