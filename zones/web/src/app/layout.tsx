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
