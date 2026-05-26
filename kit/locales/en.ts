/**
 * Shared UI English strings
 *
 * This file holds the English text for every piece of shared AMPL interface —
 * the footer, the header's language switcher, the signed-in account widget, the
 * "report a problem" dialog, and the "no access" page. A consuming tool merges
 * these into its own translation bundle under the `kit` namespace, so the
 * shared components speak the same words in every tool. The coverage is
 * deliberately narrow: the two statutory footer links are translated, but the
 * lab name, postal address, and Regents copyright line stay in English in both
 * languages, and error-message wording is supplied by the consuming tool rather
 * than living here.
 *
 * @version v0.1.0
 */
export default {
  footer: {
    terms: "Terms of Use",
    accessibility: "Accessibility",
  },
  header: {
    localeLabel: "Switch language",
  },
  accountWidget: {
    signOut: "Sign out",
  },
  reportProblem: {
    trigger: "Report a problem",
    title: "Report a Problem",
    body: "Problem reporting is coming soon. For now, please email the lab directly.",
    submit: "Submit",
    close: "Close",
  },
  noAccess: {
    overline: "ACCESS DENIED",
    title: "You don't have access to this tool",
    body: "Contact the tool administrator to request access.",
    back: "Go back",
  },
} as const;
