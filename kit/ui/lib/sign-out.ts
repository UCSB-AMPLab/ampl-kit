/**
 * Sign-out action URL builder
 *
 * Shared by AccountWidget and the AmplHeader AccountMenu. Appends a guarded
 * `return_to` to the logout endpoint without clobbering any query string the
 * href already carries. Built with URLSearchParams (not string concat) so
 * existing params survive and the value is encoded; the split on "?" keeps it
 * working for relative hrefs, which `new URL()` can't parse without a base.
 *
 * @version v0.3.0
 */
export function buildSignOutAction(signOutHref: string, returnTo?: string): string {
  if (!returnTo) return signOutHref;
  const [path, existingQuery = ""] = signOutHref.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set("return_to", returnTo);
  return `${path}?${params.toString()}`;
}
