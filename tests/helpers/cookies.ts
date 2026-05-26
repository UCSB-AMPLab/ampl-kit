/**
 * Test-side cookie helpers
 *
 * This module is the test suite's reader for `Set-Cookie` headers — the inverse
 * of the cookie builders in `app/sessions.server.ts`. It parses a raw header
 * into a cookie's value and its attributes, carefully splitting headers that
 * carry several cookies at once (a single comma inside an `Expires` date must
 * not be mistaken for a cookie boundary). It also pulls the session cookie out
 * of a response by either of its two valid names, so tests can assert on what
 * the routes actually emitted.
 *
 * @version v0.1.0
 */

export interface ParsedCookie {
  value: string;
  attrs: Record<string, string | true>;
}

export function parseSetCookie(headerValue: string | null): Map<string, ParsedCookie> {
  const out = new Map<string, ParsedCookie>();
  if (!headerValue) return out;

  // A single Set-Cookie header may contain multiple cookies when delivered as
  // Headers.get() (which joins with ", "). Splitting on bare commas is wrong
  // because expires/date attrs include commas. We split on ", " only when the
  // next non-space char is followed by a cookie-name=value pattern.
  const cookieStrings = splitCookies(headerValue);

  for (const cookieStr of cookieStrings) {
    const parts = cookieStr.split(";").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const firstEq = parts[0].indexOf("=");
    if (firstEq === -1) continue;
    const name = parts[0].slice(0, firstEq).trim();
    const value = parts[0].slice(firstEq + 1).trim();
    const attrs: Record<string, string | true> = {};
    for (const attr of parts.slice(1)) {
      const eq = attr.indexOf("=");
      if (eq === -1) {
        attrs[attr.toLowerCase()] = true;
      } else {
        const key = attr.slice(0, eq).trim().toLowerCase();
        const val = attr.slice(eq + 1).trim();
        attrs[key] = val;
      }
    }
    out.set(name, { value, attrs });
  }
  return out;
}

function splitCookies(headerValue: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  while (i < headerValue.length) {
    const ch = headerValue[i];
    if (ch === "," && i + 1 < headerValue.length) {
      // Look ahead: a new cookie begins with optional whitespace then a
      // token followed by "=".
      let j = i + 1;
      while (j < headerValue.length && headerValue[j] === " ") j++;
      const rest = headerValue.slice(j);
      const eqIdx = rest.indexOf("=");
      const semiIdx = rest.indexOf(";");
      // If "=" appears before ";" (or no ";" at all) AND the chars before "="
      // look like a cookie-name (no spaces), treat it as a cookie boundary.
      if (eqIdx !== -1 && (semiIdx === -1 || eqIdx < semiIdx)) {
        const candidate = rest.slice(0, eqIdx);
        if (/^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/.test(candidate)) {
          out.push(buf);
          buf = "";
          i = j;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

export function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

export interface ExtractedSessionCookie {
  name: string;
  value: string;
  attrs: Record<string, string | true>;
}

export function extractSessionCookie(response: Response): ExtractedSessionCookie | null {
  // Workers Response.headers.getSetCookie() returns string[] when available.
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  let setCookies: string[] = [];
  if (typeof headers.getSetCookie === "function") {
    setCookies = headers.getSetCookie();
  } else {
    const raw = response.headers.get("set-cookie");
    if (raw) setCookies = [raw];
  }
  const candidateNames = ["__Host-ampl_session", "ampl_session"];
  for (const raw of setCookies) {
    const parsed = parseSetCookie(raw);
    for (const name of candidateNames) {
      const entry = parsed.get(name);
      if (entry) {
        return { name, value: entry.value, attrs: entry.attrs };
      }
    }
  }
  return null;
}
