import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Sign in · ZoneLore" };

export default function Page() {
  return <AuthForm mode="login" />;
}
