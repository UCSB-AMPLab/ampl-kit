/**
 * AmplHeader prop and data contracts (NavItem, ToolLink, AccountInfo, HeaderSize,
 * AmplHeaderProps). The shared type surface consumed across the header components.
 *
 * @version v0.3.0
 */
import type { ReactNode } from "react";

/** Internal tool id (codename), e.g. "calamus". Drives switcher "current". */
export type ToolId = string;

export interface NavItem {
  label: ReactNode;
  href: string;
  /** Marks the active route — white text + 2px underline. */
  active?: boolean;
  /** Renders muted + non-interactive (for not-yet-built routes). */
  disabled?: boolean;
}

export interface ToolLink {
  id: ToolId;
  /** Public display name (proper noun — not translated). */
  name: string;
  /** English descriptor; localised by id via `switcher.tagline.<id>` when present. */
  descriptor: string;
  href: string;
}

export interface AccountInfo {
  name: string;
  handle?: string;
  avatarUrl: string | null;
  /** POST logout endpoint; defaults to "/auth/logout". */
  signOutHref?: string;
  /** Post-logout destination, guarded + appended as ?return_to=. */
  returnTo?: string;
  /** Optional extra menu links (e.g. Settings, Report a problem). */
  menu?: { label: ReactNode; href: string }[];
}

export type HeaderSize = "full" | "compact";

export interface AmplHeaderProps {
  /** Internal tool id — drives the switcher "current" highlight. */
  tool: ToolId;
  /** Public display name shown in the WORKSHOP band (e.g. "Paleography"). */
  toolName: string;
  /** Institutional-band scale. Default "compact"; "full" only on the signed-out front door. */
  size?: HeaderSize;
  /** Contextual in-app nav. Omit for public/front-door states. */
  nav?: NavItem[];
  /** Optional context chip (e.g. the current group), rendered after the switcher. */
  context?: ReactNode;
  /** Pre-wired `<LocaleSwitcher variant="on-dark" .../>`. */
  localeSwitcher: ReactNode;
  /** Signed-in account. null/undefined → public/signed-out (sign-in link shown). */
  account?: AccountInfo | null;
  /** Sign-in href, shown when `account` is null. */
  signInHref?: string;
  /** Sign-in label override (default: kit `header.signIn`). e.g. "Host sign in". */
  signInLabel?: ReactNode;
  /** Cross-tool switcher registry. Default: DEFAULT_TOOLS. */
  tools?: ToolLink[];
  /** Lab-home href for the lockup. Default: the live lab site. */
  labHome?: string;
}
