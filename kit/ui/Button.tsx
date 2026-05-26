/**
 * Button primitive
 *
 * This file defines the single styled button shared across every AMPL tool. It
 * comes in two shapes — a filled "pill" for primary calls to action (such as
 * "Continue with GitHub") and a borderless "text" button for secondary actions
 * (such as "Sign out"). The same component can render as a real `<button>` or
 * as an `<a>` link through the `as` prop while keeping identical styling, so
 * one primitive serves both form submissions and navigation. Styling is
 * deliberately flat — no shadows, gradients, or frosted glass.
 *
 * @version v0.1.0
 */

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";

type BaseProps = {
  variant?: "fill" | "text";
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

export function Button(props: ButtonProps) {
  const { variant = "fill", as: Tag = "button", children, ...rest } = props;
  const className = variant === "fill" ? fillClasses : textClasses;

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
