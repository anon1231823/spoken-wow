import Script from "next/script";

/**
 * Cloudflare Web Analytics, which the site uses despite not being on Cloudflare at all.
 *
 * The beacon reports from the browser to `static.cloudflareinsights.com`, so it needs
 * nothing of the origin -- no DNS move, no proxying, no change to nginx or the deploy.
 * It is cookieless and stores nothing personal, which is why there is no consent banner
 * and no privacy page alongside it.
 *
 * The token is not a secret. It ships in the HTML of every page and only names which
 * dashboard the hits land in, so it lives here rather than in `shared/app.env`. It could
 * not usefully live in the pm2 environment anyway: a `NEXT_PUBLIC_*` value is inlined at
 * build time, in CI, and `ecosystem.config.js` sets its variables at boot -- far too late.
 */
const BEACON_TOKEN = "c54c6889f8fe449696982c52020d42f9";

export function Analytics() {
  // Development and CI would otherwise report as traffic: `next dev` on every page load,
  // and the workflow's smoke check, which boots the real production bundle.
  if (process.env.NODE_ENV !== "production") return null;

  return (
    <Script
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: BEACON_TOKEN })}
      // The beacon has nothing to contribute to first paint, and it hooks the History API
      // itself once loaded, so client-side navigation between routes is counted without
      // any per-route wiring here.
      strategy="afterInteractive"
    />
  );
}
