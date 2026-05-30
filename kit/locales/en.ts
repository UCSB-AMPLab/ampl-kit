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
  email: {
    footer: {
      transactional: "This is an automated transactional message from AMPL.",
      tagline: "Archives, Memory, and Preservation Lab · UC Santa Barbara",
      unsubscribeLabel: "Unsubscribe",
    },
    unsubscribe: {
      pageTitle: "Unsubscribe from AMPL emails",
      heading: "Unsubscribe",
      explain:
        "Confirming will remove this address from all AMPL transactional mail. This is a global action — you will no longer receive automated messages from any AMPL tool (Calamus, Scheduling, or any future tool).",
      button: "Confirm unsubscribe",
      confirmedHeading: "You have been unsubscribed",
      confirmedBody:
        "Your address has been removed from our list. You will no longer receive transactional emails from any AMPL tool.",
    },
  },
  footer: {
    terms: "Terms of Use",
    accessibility: "Accessibility",
  },
  header: {
    localeLabel: "Switch language",
    signIn: "Sign in",
    menuLabel: "Menu",
  },
  nav: {
    ariaLabel: "Lab site navigation",
    tools: "Tools",
    projects: "Projects",
    opportunities: "Opportunities",
    people: "People",
  },
  switcher: {
    heading: "AMPL Workshop",
    tagline: {
      calamus: "Practice reading manuscripts",
      scheduling: "booking & polls",
    },
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
