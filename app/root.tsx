/**
 * Root document and app shell
 *
 * This file is the outermost wrapper around every page the app renders. It
 * owns the HTML document itself — the `<html>`, `<head>`, and `<body>` — and
 * paints the persistent chrome that surrounds each route: the AMPL site header
 * with its "AMPL Auth" lockup, a language switcher, and the shared footer. Two
 * middlewares run here for every request — `securityMiddleware`, which mints
 * the per-request CSP nonce, and `i18nextMiddleware`, which resolves the
 * active language — and the root loader hands both the chosen `locale` and the
 * `nonce` down to the layout so scripts can be allow-listed by the Content
 * Security Policy. It also wires the language switcher's links, carefully
 * stripping and re-adding the `/auth` base path so a locale change returns the
 * user to the exact page they were on. Finally, it provides the `ErrorBoundary`
 * — the friendly, translated fallback shown when a route throws or a page is
 * not found, with a developer stack trace surfaced only in development.
 *
 * @version v0.1.0
 */

import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import { useTranslation } from "react-i18next";

import type { Route } from "./+types/root";
import { i18nextMiddleware, getLocale } from "~/middleware/i18next";
import { securityMiddleware, nonceContext } from "~/middleware/security";
import { withBase, stripBasename } from "~/lib/paths";
import { kitFontLinks } from "@ampl/kit/fonts";
import { SiteHeader, SiteFooter, LocaleSwitcher } from "@ampl/kit/ui";
import amplLogo from "@ampl/kit/assets/ampl-logo.svg";
import "./app.css";

export const middleware = [securityMiddleware, i18nextMiddleware];

export const links: Route.LinksFunction = () => [...kitFontLinks];

export async function loader({ context }: Route.LoaderArgs) {
  const locale = getLocale(context);
  const nonce = context.get(nonceContext);
  if (!nonce) throw new Error("CSP nonce missing — securityMiddleware did not run");
  return { locale, nonce };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const locale = data?.locale ?? "en";
  const nonce = data?.nonce ?? "";
  const location = useLocation();
  const { t } = useTranslation("common");

  // Build the locale-switch href: strip basename from current path so the
  // locale route can reconstruct it correctly, then prefix with withBase.
  // The kit LocaleSwitcher receives a pre-wired buildHref; it does NOT import
  // ~/lib/paths (the kit is dependency-free).
  const buildLocaleHref = (lng: "en" | "es") => {
    const to = stripBasename(location.pathname);
    return withBase(`/locale?lng=${lng}&to=${encodeURIComponent(to)}`);
  };

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <div className="flex min-h-screen flex-col">
          <SiteHeader
            localeSwitcher={
              <LocaleSwitcher
                buildHref={buildLocaleHref}
                current={locale as "en" | "es"}
              />
            }
            nav={
              <nav
                aria-label={t("nav.ariaLabel")}
                className="flex max-w-[480px] flex-wrap items-center justify-end gap-x-9 gap-y-1.5"
              >
                <a
                  href="https://ampl.clair.ucsb.edu/#tools"
                  className="font-title text-[20px] lg:text-[24px] xl:text-[28px] font-medium leading-none uppercase tracking-[0.4px] text-fg-1 hover:text-accent no-underline"
                >
                  {t("nav.tools")}
                </a>
                <a
                  href="https://ampl.clair.ucsb.edu/#projects"
                  className="font-title text-[20px] lg:text-[24px] xl:text-[28px] font-medium leading-none uppercase tracking-[0.4px] text-fg-1 hover:text-accent no-underline"
                >
                  {t("nav.projects")}
                </a>
                <a
                  href="https://ampl.clair.ucsb.edu/#opportunities"
                  className="font-title text-[20px] lg:text-[24px] xl:text-[28px] font-medium leading-none uppercase tracking-[0.4px] text-fg-1 hover:text-accent no-underline"
                >
                  {t("nav.opportunities")}
                </a>
                <a
                  href="https://ampl.clair.ucsb.edu/people"
                  className="font-title text-[20px] lg:text-[24px] xl:text-[28px] font-medium leading-none uppercase tracking-[0.4px] text-fg-1 hover:text-accent no-underline"
                >
                  {t("nav.people")}
                </a>
              </nav>
            }
          >
            {/* AMPL logo — links to lab home; img is decorative (aria-label on anchor) */}
            <a
              href="https://ampl.clair.ucsb.edu/"
              aria-label="AMPL — Archives, Memory, and Preservation Lab"
            >
              <img
                src={amplLogo}
                alt=""
                className="h-auto w-[300px] lg:w-[400px] xl:w-[500px]"
              />
            </a>
          </SiteHeader>
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation("common");

  let message = t("oops");
  let details = t("unexpectedError");
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      message = t("notFound");
      details = t("notFoundMessage");
    } else {
      message = t("errorLabel");
      details = error.statusText || details;
    }
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1 className="text-2xl font-semibold">{message}</h1>
      <p className="mt-2">{details}</p>
      <a href={withBase("/")} className="mt-4 inline-block text-sm underline">
        {t("backToHome")}
      </a>
      {stack && (
        <pre className="mt-4 w-full rounded border p-4 overflow-x-auto text-sm">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
