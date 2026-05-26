import { useRef } from "react";
import { useTranslation } from "react-i18next";

/**
 * Report-a-problem dialog
 *
 * This file renders the "report a problem" feature as a deliberate placeholder:
 * the dialog looks finished, but it does nothing yet. There is no submit
 * handler, no form post, no network call, and no data collection of any kind —
 * the submit button is permanently disabled and visibly greyed out — so the
 * interface can ship now and gain a real backend later. It is built on the
 * browser's native dialog element, which gives it a proper focus trap and
 * Escape-to-close for free without extra code. The trigger is styled as a quiet
 * footer link, meant to sit in the left column of the site footer, and the
 * dimmed backdrop is a flat scrim with no frosted-glass effect.
 *
 * @version v0.1.0
 */

export function ReportProblem() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation("kit");

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="cursor-pointer border-0 bg-none p-0 font-body text-small text-bg/80 hover:text-bg hover:underline"
        type="button"
      >
        {t("reportProblem.trigger")}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="report-title"
        className="w-full max-w-[480px] rounded-sm border border-border bg-bg p-6 backdrop:bg-fg-1/40"
      >
        <h2
          id="report-title"
          className="mb-3 font-title text-h5 text-fg-1"
        >
          {t("reportProblem.title")}
        </h2>
        <p className="mb-6 font-body text-body text-fg-2">
          {t("reportProblem.body")}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => dialogRef.current?.close()}
            className="font-title text-[13px] font-medium uppercase tracking-[0.4px] text-fg-1 hover:text-accent"
            type="button"
          >
            {t("reportProblem.close")}
          </button>
          <button
            disabled
            className="cursor-not-allowed rounded-pill bg-accent px-5 py-3.5 font-title text-[13px] font-medium uppercase tracking-[0.4px] text-bg opacity-40"
            type="button"
          >
            {t("reportProblem.submit")}
          </button>
        </div>
      </dialog>
    </>
  );
}
