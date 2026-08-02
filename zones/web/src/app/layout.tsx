import type { Metadata } from "next";
import Link from "next/link";

import { FeedbackLauncher } from "@/components/FeedbackLauncher";
import { UserMenu } from "@/components/UserMenu";
import { SUPPORT_URL } from "@/lib/support";

import "./globals.css";

export const metadata: Metadata = {
  // Pages set only their own name; the template does the branding. `default` is what
  // the homepage gets -- a bare "ZoneLore", with nothing after it to name.
  title: { default: "ZoneLore", template: "ZoneLore — %s" },
  description: "Browse, listen to and regenerate the narrated zone lore.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-fg">
        {/* The rule spans the viewport; only its contents are constrained. */}
        <header className="border-b border-border">
          <div className="shell flex h-12 items-center gap-4">
            <Link href="/" className="font-semibold">
              ZoneLore
            </Link>
            {/* Outside UserMenu because it needs no role and no session -- see the
                component for why that matters. */}
            <FeedbackLauncher />
            {/* A plain <a>, not <Link>: next/link exists to prefetch in-app routes and
                there is nothing here to prefetch. rel="noopener" because target="_blank"
                otherwise hands the opened page a window.opener handle on this one.

                The only filled control in the header, deliberately -- everything else up
                here is a muted text link, so the one thing that is an ask reads as a
                button. text-bg rather than a literal black: it is the page's own
                near-black, which is what "black text" means in this palette. */}
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-accent px-2 py-0.5 text-sm font-medium text-bg hover:opacity-90"
            >
              Support
            </a>
            {/* Pronunciation moved into UserMenu, which is where the links that need a
                role live. It is not a page a visitor can do anything with. */}
            <UserMenu />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
