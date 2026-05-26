/**
 * Landing page
 *
 * This file renders the bare `/auth` landing — the page a user reaches when
 * sign-in completes with nowhere specific to go, or when they navigate to
 * `/auth` directly. Its loader reads the session cookie and resolves it to a
 * user, but never redirects: a signed-in visitor sees their account details
 * (name, handle, avatar) with a sign-out link and a prompt to return to their
 * tool, while a signed-out visitor sees a "Continue with GitHub" call to
 * action. Authentication is deliberately not enforced here — both states are
 * valid, and there is no access-denied page.
 *
 * @version v0.1.0
 */

import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import { drizzle } from "drizzle-orm/d1";
import { AccountWidget, Button } from "@ampl/kit/ui";
import { withBase } from "~/lib/paths";
import { getSessionFromRequest } from "~/sessions.server";
import { cloudflareContext } from "~/context";
import * as schema from "~/db/schema";
import type { Route } from "./+types/_index";

export function meta({ data }: Route.MetaArgs) {
  const signedIn = Boolean(data?.user);
  return [
    { title: signedIn ? "Signed in — AMPL" : "Sign in — AMPL" },
    {
      name: "description",
      content: signedIn
        ? "You are signed in to the AMPL tools suite."
        : "Sign in with GitHub to access the AMPL tools suite.",
    },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  const db = drizzle(env.AUTH_DB, { schema });
  const resolved = await getSessionFromRequest(db, request);
  // Return user (or null) without redirecting.
  return { user: resolved?.user ?? null };
}

export default function Index() {
  const { t } = useTranslation("common");
  const { user } = useLoaderData<typeof loader>();

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-[30px] py-20">
      <div className="w-full max-w-[480px]">
        <h1 className="mb-4 font-title text-h4 text-fg-1">
          {t(user ? "signedIn.title" : "signedOut.title")}
        </h1>
        {user ? (
          <>
            <AccountWidget
              name={user.name ?? user.handle}
              handle={user.handle}
              avatarUrl={user.avatarUrl}
              signOutHref={withBase("/logout")}
            />
            <p className="mt-6 font-body text-body text-fg-2">
              {t("signedIn.returnPrompt")}
            </p>
          </>
        ) : (
          <>
            <p className="mb-6 font-body text-body text-fg-2">{t("signedOut.body")}</p>
            <Button as="a" variant="fill" href={withBase("/github")}>
              {t("login.continueWithGithub")}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
