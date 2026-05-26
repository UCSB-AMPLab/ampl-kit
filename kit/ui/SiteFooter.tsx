import { useTranslation } from "react-i18next";
import ucsbWordmark from "../assets/ucsb-wordmark-white.svg";
import clairLogo from "../assets/clair-logo-white.svg";
import { ReportProblem } from "./ReportProblem";

/**
 * Site footer
 *
 * This file renders the shared institutional footer that anchors the bottom of
 * every AMPL tool. It is two full-width plum bands: an upper band carrying the
 * UCSB wordmark, the lab's name and postal address, and the CLAIR logo; and a
 * lower band carrying the Regents copyright line and the two statutory links
 * (terms of use and accessibility). Only those two link labels are translated —
 * the lab name, address, and Regents wording stay in English in both languages
 * — and the copyright year is computed at render time rather than hard-coded.
 * The "report a problem" trigger sits in the left column beneath the address.
 * The logos are loaded as image files rather than inline SVGs to fit the build
 * tooling's constraints.
 *
 * @version v0.1.0
 */

export function SiteFooter() {
  const { t } = useTranslation("kit");
  const year = new Date().getFullYear();

  return (
    <footer>
      {/* Band 1 — institutional lockups — bg-accent-ink (#8B467D) */}
      <div className="bg-accent-ink text-bg">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-10 px-7.5 py-16 md:grid-cols-2 md:py-20">
          {/* Left — AMPL lockup: UCSB wordmark + lab name + address */}
          <div className="justify-self-start">
            <img
              src={ucsbWordmark}
              alt="University of California, Santa Barbara"
              className="h-auto w-full max-w-[342px]"
            />
            <p className="mt-3 font-title text-[30px] font-normal leading-none">
              Archives, Memory,
              <br />
              and Preservation Lab
            </p>
            <address className="mt-3 text-sm not-italic leading-6">
              <a
                href="https://ampl.clair.ucsb.edu/map"
                className="hover:underline"
              >
                2313 Girvetz Hall
              </a>
              <br />
              University of California, Santa Barbara
              <br />
              Santa Barbara, CA 93106-2150
              <br />
              Campus Mail Code: 2150
            </address>
            {/* ReportProblem trigger */}
            <div className="mt-4">
              <ReportProblem />
            </div>
          </div>

          {/* Right — CLAIR Quipu logo */}
          <a
            href="https://clair.ucsb.edu"
            className="justify-self-start md:justify-self-end"
            aria-label="Center for Latin American and Iberian Research"
          >
            <img
              src={clairLogo}
              alt=""
              className="h-auto w-full max-w-[80%]"
            />
          </a>
        </div>
      </div>

      {/* Band 2 — Regents copyright strip — bg-accent-deep (#743A6A) */}
      <div className="bg-accent-deep text-bg">
        <div className="mx-auto max-w-[1200px] px-5 pt-4 pb-12 text-xs">
          Copyright © {year} The Regents of the University of California. All
          Rights Reserved.
          <a
            href="https://www.ucsb.edu/terms-of-use"
            className="ml-4 font-medium hover:underline"
          >
            {t("footer.terms")}
          </a>
          <a
            href="https://clair.ucsb.edu/accessibility"
            className="ml-4 font-medium hover:underline"
          >
            {t("footer.accessibility")}
          </a>
        </div>
      </div>
    </footer>
  );
}
