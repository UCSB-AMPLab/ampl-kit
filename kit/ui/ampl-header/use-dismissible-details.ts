/**
 * useDismissibleDetails — native <details> menus don't dismiss on Escape or
 * outside-click, and two of them can sit open at once (G2). This hook wires both
 * behaviours onto a <details> ref: a pointerdown outside the element closes it
 * (which also closes one menu when you open another), and Escape closes it and
 * returns focus to the <summary>. SSR-safe — the listeners are client-only.
 *
 * @version v0.3.3
 */
import { useEffect, type RefObject } from "react";

export function useDismissibleDetails(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const d = ref.current;
      if (d?.open && e.target instanceof Node && !d.contains(e.target)) {
        d.open = false;
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      const d = ref.current;
      if (d?.open && e.key === "Escape") {
        d.open = false;
        d.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref]);
}
