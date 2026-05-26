/**
 * Server-side rendering entry point
 *
 * This file turns a matched route into the HTML string the browser first
 * receives. It streams the React tree to the response, threading through the
 * per-request CSP nonce that `securityMiddleware` generated so the inline
 * scripts React emits are trusted by the Content Security Policy. For search
 * engines and other bots — and for SPA-mode renders — it waits for the whole
 * page to finish before responding, so crawlers see complete content rather
 * than a streaming shell; for ordinary visitors it streams as soon as the
 * shell is ready. Rendering errors raised after the shell has flushed are
 * logged here.
 *
 * @version v0.1.0
 */

import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { nonceContext } from "~/middleware/security";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");
  const nonce = (loadContext as any).get?.(nonceContext) ?? "";

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    {
      nonce,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell.  Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    }
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
