/**
 * Lab-site navigation links
 *
 * The institutional band's four lab-site nav entries, shared by the desktop
 * InstitutionalBand and the mobile sheet so the hrefs cannot silently diverge.
 * Labels resolve at render via the `kit` i18n `nav.<key>` strings.
 *
 * @version v0.3.0
 */
export const LAB_NAV = [
  { key: "tools", href: "https://ampl.clair.ucsb.edu/#tools" },
  { key: "projects", href: "https://ampl.clair.ucsb.edu/#projects" },
  { key: "opportunities", href: "https://ampl.clair.ucsb.edu/#opportunities" },
  { key: "people", href: "https://ampl.clair.ucsb.edu/people" },
] as const;
