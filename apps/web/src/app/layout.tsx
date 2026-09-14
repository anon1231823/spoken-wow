import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import Link from "next/link";
import Script from "next/script";
import UserMenu from "@/components/UserMenu";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Spoken",
  description: "Voiced dialogue, lore and text for World of Warcraft Classic",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark-only for now: this is a tool for listening to game dialog, and the light
    // palette is untested. The shadcn tokens make flipping it a one-line change.
    <html lang="en" className={cn("dark font-sans", geist.variable)}>
      <body>
        <header className="border-b">
          <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 px-5">
            <Link href="/" className="text-sm font-medium">
              Spoken
            </Link>
            <UserMenu />
          </div>
        </header>
        {children}
        {/* Cloudflare Web Analytics. Production only, so local page views don't
            land in the same dashboard as real traffic. */}
        {process.env.NODE_ENV === "production" && (
          <Script
            type="module"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon='{"token": "e4a25ce72fd94bf8a0ed83e1d34c0b1c"}'
          />
        )}
      </body>
    </html>
  );
}
