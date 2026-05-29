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
 * @version v0.2.1
 */

export type { SendMessage, SendResult } from "../../kit/email/types";
