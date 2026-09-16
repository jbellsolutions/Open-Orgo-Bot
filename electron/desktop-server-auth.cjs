"use strict";

// Protocol compatibility identifier, not user-facing branding. The server
// deliberately continues to accept this exact header across renamed builds.
const DESKTOP_MUTATION_HEADER = "X-Open Orgo Bot-Desktop-Owner";

/** Add the per-launch owner capability to main-process requests. Chromium's
 * webRequest hook cannot see Node fetch, so both paths use this one header
 * contract rather than relying on where a request happened to originate. */
function desktopServerHeaders(headers, { packaged, token }) {
  const next = { ...headers };
  if (!packaged) return next;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("invalid desktop mutation capability");
  }
  next[DESKTOP_MUTATION_HEADER] = token;
  return next;
}

module.exports = { DESKTOP_MUTATION_HEADER, desktopServerHeaders };
