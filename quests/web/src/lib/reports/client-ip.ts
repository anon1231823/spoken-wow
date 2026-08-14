/**
 * Which IP a request counts against for rate limiting.
 *
 * `x-real-ip` only, never `x-forwarded-for`. nginx overwrites the former
 * (deploy/nginx-voiceover.conf) and appends to the latter, so a client that sends its own
 * X-Forwarded-For header lands in a fresh rate-limit bucket on every request - which is the
 * whole limit, defeated by one header.
 *
 * When the header is missing, everyone shares the "unknown" bucket. That is the strict failure
 * on purpose: a misconfigured proxy should throttle, not wave everything through.
 */
export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
