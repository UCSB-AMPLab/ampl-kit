/**
 * AmplHeader — the unified two-band header for every ampl.tools tool.
 *
 * Composes the institutional band, the deep-plum WORKSHOP band, and the mobile
 * sheet; holds the single mobile-sheet open/close state. All tool variation
 * comes through props. The public entry point for the component.
 *
 * @version v0.3.0
 */
import { useState } from "react";
import { InstitutionalBand } from "./InstitutionalBand";
import { WorkshopBand } from "./WorkshopBand";
import { MobileSheet } from "./MobileSheet";
import { DEFAULT_TOOLS } from "./tools";
import type { AmplHeaderProps } from "./types";

/**
 * The unified AMPL header. Two bands: the institutional AMPL identity (logo +
 * lab nav, owned by the kit, scales full/compact) and the deep-plum WORKSHOP
 * band (tool switcher + contextual nav + EN/ES + account/sign-in). Anchored
 * dropdowns use native <details>; the full-width mobile sheet uses one state
 * toggle here. All tool variation comes through props.
 */
export function AmplHeader({
  tool,
  toolName,
  size = "compact",
  nav,
  context,
  localeSwitcher,
  account = null,
  signInHref,
  signInLabel,
  tools = DEFAULT_TOOLS,
  labHome = "https://ampl.clair.ucsb.edu/",
}: AmplHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative">
      <InstitutionalBand
        size={size}
        labHome={labHome}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((v) => !v)}
      />
      <WorkshopBand
        tool={tool}
        toolName={toolName}
        nav={nav}
        context={context}
        localeSwitcher={localeSwitcher}
        account={account}
        signInHref={signInHref}
        signInLabel={signInLabel}
        tools={tools}
      />
      <MobileSheet
        open={menuOpen}
        nav={nav}
        context={context}
        localeSwitcher={localeSwitcher}
        account={account}
        signInHref={signInHref}
        signInLabel={signInLabel}
      />
    </header>
  );
}
