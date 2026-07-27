import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
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
      <body>{children}</body>
    </html>
  );
}
