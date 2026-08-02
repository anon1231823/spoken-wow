import type { Metadata } from "next";
import Link from "next/link";

import { FeedbackLauncher } from "@/components/FeedbackLauncher";
import { UserMenu } from "@/components/UserMenu";

import "./globals.css";

export const metadata: Metadata = {
  title: "ZoneLore voicelines",
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
                otherwise hands the opened page a window.opener handle on this one. */}
            <a
              href="https://buymeacoffee.com/rustykey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-fg"
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
