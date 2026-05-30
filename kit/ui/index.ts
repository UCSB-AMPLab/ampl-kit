/**
 * Shared UI barrel
 *
 * This file is the single front door to every shared AMPL interface piece, so a
 * consuming tool can import them all from one place. It gathers the page chrome
 * and primitives — the institutional footer, the header shell, the EN/ES
 * language switcher, and the button — together with the shared auth and
 * feedback surfaces — the signed-in account widget, the auth-error alert, the
 * "no access" page, and the "report a problem" dialog. Everything re-exported
 * here is purely presentational: props in, markup out, no data loading or
 * app-specific logic. The session-validation code deliberately lives in its own
 * separate module and is not exposed through this barrel.
 *
 * @version v0.3.0
 */

export { SiteFooter } from "./SiteFooter";
/** @deprecated Superseded by AmplHeader (v0.3.0). Kept for back-compat. */
export { SiteHeader } from "./SiteHeader";
export { AmplHeader, DEFAULT_TOOLS } from "./ampl-header";
export type { AmplHeaderProps, NavItem, ToolLink, ToolId, AccountInfo, HeaderSize } from "./ampl-header";
export { LocaleSwitcher } from "./LocaleSwitcher";
export { Button } from "./Button";
export { AccountWidget } from "./AccountWidget";
export { AuthError } from "./AuthError";
export { NoAccess } from "./NoAccess";
export { ReportProblem } from "./ReportProblem";
