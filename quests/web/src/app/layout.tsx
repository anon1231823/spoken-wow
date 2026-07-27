import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoiceOver Explorer",
  description: "Find and play WoW Classic voicelines by NPC or quest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
