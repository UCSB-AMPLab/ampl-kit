/**
 * Button primitive
 *
 * This file defines the single styled button shared across every AMPL tool. It
 * comes in three shapes — a filled "pill" for primary calls to action, a
 * borderless "text" button for secondary actions (such as "Sign out"), and a
 * dark GitHub-style button for the OAuth sign-in (such as "Continue with GitHub").
 * The same component can render as a real `<button>` or as an `<a>` link
 * through the `as` prop while keeping identical styling, so one primitive
 * serves both form submissions and navigation. Styling is deliberately flat —
 * no shadows, gradients, or frosted glass.
 *
 * The `dark` variant follows GitHub's native button styling — system-sans
 * 14px/600, GitHub brand dark (`#24292e`, hover `#2c3238`), white text, and a
 * 6px radius. The consumer supplies any brand mark (e.g. an inline Octocat SVG)
 * as a child — the Button owns no brand assets.
 *
 * @version v0.2.0
 */

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";

type BaseProps = {
  variant?: "fill" | "text" | "dark";
  children: ReactNode;
};

type ButtonElementProps = BaseProps & {
  as?: "button";
  href?: never;
} & ButtonHTMLAttributes<HTMLButtonElement>;

type AnchorElementProps = BaseProps & {
  as: "a";
  href?: string;
} & AnchorHTMLAttributes<HTMLAnchorElement>;

type ButtonProps = ButtonElementProps | AnchorElementProps;

const fillClasses =
  "inline-flex items-center justify-center gap-2.5 " +
  "font-title text-[13px] font-medium uppercase tracking-[0.4px] " +
  "text-bg bg-accent rounded-pill px-[26px] py-3.5 " +
  "cursor-pointer no-underline " +
  "transition-[filter] duration-[120ms] hover:brightness-[0.92] active:scale-[0.98]";

const textClasses =
  "inline-flex items-center gap-2 " +
  "font-title text-[13px] font-medium uppercase tracking-[0.4px] " +
  "text-fg-1 bg-transparent border-0 p-0 " +
  "cursor-pointer no-underline hover:text-accent";

const darkClasses =
  "inline-flex items-center justify-center gap-2.5 " +
  "font-sans text-[14px] font-semibold " +
  "text-white bg-[#24292e] rounded-[6px] px-5 py-2.5 " +
  "cursor-pointer no-underline " +
  "transition-colors duration-[120ms] hover:bg-[#2c3238]";

const variantClasses: Record<string, string> = {
  fill: fillClasses,
  text: textClasses,
  dark: darkClasses,
};

export function Button(props: ButtonProps) {
  const { variant = "fill", as: Tag = "button", children, ...rest } = props;
  const className = variantClasses[variant] ?? fillClasses;

  if (Tag === "a") {
    const { href, ...anchorRest } = rest as AnchorElementProps;
    return (
      <a href={href} className={className} {...(anchorRest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }

  return (
    <button
      className={className}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}
