/**
 * @ampl/kit/email — bilingual email shell + RFC 5545 .ics builder
 *
 * This barrel re-exports the three public surfaces of the `@ampl/kit/email`
 * subpath: the branded email shell renderer, the pure iCalendar builder, and
 * the contract types. Consumers import from `@ampl/kit/email`; the underlying
 * modules (`./shell`, `./ics`, `./types`) are not part of the public contract
 * — the barrel is the single stable entry point.
 *
 * Named exports only. No default export. The contract is pinned to the git tag
 * (one version number for the whole subpath); see CONSUMING.md for the
 * breaking-change policy and copy-paste integration recipes.
 *
 * @version v0.2.0
 */

export { renderEmailShell } from "./shell";
export { buildIcs } from "./ics";
export type { EmailShellInput, EmailBlock, IcsEvent } from "./types";
