/**
 * Auth error alert
 *
 * This file renders the small inline banner that tells a user something went
 * wrong while signing in. It is intentionally minimal: it takes a single
 * already-translated message and shows it inside an accessible alert region
 * styled with the design system's error colours. The translation happens in the
 * consuming tool, so this component never touches i18n itself, and because the
 * message is rendered as ordinary text it cannot inject markup.
 *
 * Props contract:
 *   message — already-translated string; the consumer calls t() before
 *             passing it in. AuthError does NOT call useTranslation().
 *
 * @version v0.1.0
 */

type AuthErrorProps = {
  /** Already-translated error message from the consumer's errors.* namespace. */
  message: string;
};

export function AuthError({ message }: AuthErrorProps) {
  return (
    <div
      role="alert"
      className="mb-6 rounded-sm border border-error/30 bg-error/8 px-4 py-3 font-body text-small text-error"
    >
      {message}
    </div>
  );
}
