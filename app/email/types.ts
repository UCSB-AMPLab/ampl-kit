/**
 * Email service public contract — Worker-side re-export
 *
 * The canonical `SendMessage` / `SendResult` definitions moved to the shared
 * library at `kit/email/types.ts` in v0.2.1, so consumers can type their
 * `EMAIL` service binding against the published, tag-versioned
 * `@ampl/kit/email` contract instead of vendoring a hand-copied interface.
 *
 * This file re-exports them for the email Worker's own internal imports
 * (`workers/email.ts`, the email tests), keeping those import paths stable.
 * The Worker thus implements the library contract rather than owning it.
 *
 * @version v0.4.0
 */

export type { SendMessage, SendResult } from "../../kit/email/types";

/**
 * The only input the `AuthEmail` entrypoint accepts (bound by ampl-auth as
 * `AUTH_EMAIL`). The email Worker renders one of two fixed templates from it;
 * a caller cannot supply a subject or body. `url` must be https, on the
 * AUTH_APP_URL origin, at `/auth/email/verify?token=<64 hex>` for a sign-in
 * link or `/auth/login` for a GitHub notice. `minutes` is the link lifetime
 * shown in the message (1 to 60).
 */
export interface AuthEmailRequest {
  to: string;
  locale: "en" | "es";
  kind: "sign-in-link" | "github-notice";
  url: string;
  minutes: number;
}
