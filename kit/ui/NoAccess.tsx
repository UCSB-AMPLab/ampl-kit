import { useTranslation } from "react-i18next";
import { Button } from "./Button";

/**
 * No-access page
 *
 * This file renders the centred "you don't have access to this tool" dead-end
 * page. It is meant for the situation where someone is signed in but is not
 * authorised to use a particular tool — so the auth tool itself never shows it;
 * instead it ships in the shared kit for the other tools to render at that
 * moment. It shows an overline, a heading, an explanatory line, and an optional
 * "go back" button that the consuming tool can hide by leaving its link out.
 * Like the rest of the shared surfaces it is presentational only and carries no
 * authorisation logic of its own.
 *
 * Props contract:
 *   toolName   — name of the tool (may be used in body copy interpolation)
 *   returnHref — optional "go back" link; omit to hide the CTA
 *
 * @version v0.1.1
 */

type NoAccessProps = {
  toolName: string;
  returnHref?: string;
};

export function NoAccess({ toolName, returnHref }: NoAccessProps) {
  const { t } = useTranslation("kit");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-[30px] py-20 text-center">
      <p className="mb-5 font-display text-[16px] tracking-[1.5px] text-accent">
        {t("noAccess.overline")}
      </p>
      <h1 className="m-0 mb-[18px] max-w-[640px] font-title text-[32px] leading-[38px] tracking-[-1px] sm:text-[44px] sm:leading-[52px]">
        {t("noAccess.title")}
      </h1>
      <p className="mx-auto mb-8 max-w-[540px] font-body text-[17px] leading-[28px] text-fg-1">
        {t("noAccess.body", { toolName })}
      </p>
      {returnHref && (
        <Button as="a" variant="fill" href={returnHref}>
          {t("noAccess.back")}
        </Button>
      )}
    </main>
  );
}
