import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import Link from "next/link";
import UserMenu from "@/components/UserMenu";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "VoiceOver Explorer",
  description: "Find and play WoW Classic voicelines by NPC or quest",
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
              VoiceOver Explorer
            </Link>
            <UserMenu />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
