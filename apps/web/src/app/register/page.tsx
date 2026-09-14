import type { Metadata } from "next";

import AuthForm from "@/components/AuthForm";

export const metadata: Metadata = { title: "Register · Spoken" };

export default function Page() {
  return (
    <main className="mx-auto max-w-4xl px-5 pt-6 pb-36">
      <AuthForm mode="register" />
    </main>
  );
}
