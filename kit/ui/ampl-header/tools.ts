import type { ToolLink } from "./types";

/**
 * The live AMPL Workshop tool registry. Display names are public ("Paleography"
 * for the calamus codebase); descriptors are English fallbacks localised at
 * render via `switcher.tagline.<id>`. Data-driven so future tools slot in.
 *
 * @version v0.3.2
 */
export const DEFAULT_TOOLS: ToolLink[] = [
  { id: "calamus", name: "Paleography", descriptor: "Practice reading manuscripts", href: "https://ampl.tools/paleography" },
  { id: "scheduling", name: "Scheduling", descriptor: "booking & polls", href: "https://ampl.tools/scheduling" },
];
