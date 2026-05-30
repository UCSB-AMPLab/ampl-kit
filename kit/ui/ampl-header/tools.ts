import type { ToolLink } from "./types";

/**
 * The live AMPL Workshop tool registry. Display names are public ("Palaeography"
 * for the calamus codebase); descriptors are English fallbacks localised at
 * render via `switcher.tagline.<id>`. Data-driven so future tools slot in.
 *
 * @version v0.3.0
 */
export const DEFAULT_TOOLS: ToolLink[] = [
  { id: "calamus", name: "Palaeography", descriptor: "Practice reading manuscripts", href: "https://ampl.tools/palaeography" },
  { id: "scheduling", name: "Scheduling", descriptor: "booking & polls", href: "https://ampl.tools/scheduling" },
];
