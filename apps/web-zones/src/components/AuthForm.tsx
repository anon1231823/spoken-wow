"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { signIn, signUp } from "@/lib/auth-client";

// Sign in and register are the same four fields and the same submit, so they are one
// component with a mode rather than two that drift apart.
//
// Registering grants nothing beyond a name on the /admin page -- see permissions.ts --
// which is why the register copy says so rather than implying an unlock.

type Mode = "login" | "register";

const COPY = {
  login: {
    title: "Sign in",
    submit: "Sign in",
    switchText: "No account yet?",
    switchLabel: "Register",
    switchHref: "/register",
  },
  register: {
    title: "Register",
    submit: "Create account",
    switchText: "Already registered?",
    switchLabel: "Sign in",
    switchHref: "/login",
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const copy = COPY[mode];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error } =
      mode === "register"
        ? await signUp.email({ name, email, password })
        : await signIn.email({ email, password });

    if (error) {
      setError(error.message ?? "Something went wrong. Try again.");
      setPending(false);
      return;
    }

    // refresh() re-runs the server components, so a page guarded on the server (/admin,
    // /lexicon) sees the new session immediately rather than on the next full load.
    router.push("/");
    router.refresh();
  }

  return (
    <main className="shell pt-8 pb-24">
      <h1 className="text-xl font-semibold">{copy.title}</h1>

      {mode === "register" && (
        <p className="mt-1 text-muted">
          An account starts with no permissions: the same browse-and-listen view as a
          visitor. An admin grants the rest.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 flex max-w-sm flex-col gap-4">
        {mode === "register" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-muted">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-muted">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            // type=email is not in globals.css's selector list, which styles the inputs
            // this app actually had until now. Rather than widen that list for two
            // fields, the two fields carry the same rules.
            className="rounded-md border border-border bg-panel px-2 py-1 text-fg"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-muted">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            // Better Auth rejects anything shorter server-side; saying so up front beats
            // a round trip to find out.
            minLength={8}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-border bg-panel px-2 py-1 text-fg"
          />
          {mode === "register" && <p className="text-xs text-faint">At least 8 characters.</p>}
        </div>

        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded border border-border px-3 py-1 hover:bg-panel-hover disabled:opacity-40"
        >
          {pending ? "Working…" : copy.submit}
        </button>

        <p className="text-muted">
          {copy.switchText}{" "}
          <Link href={copy.switchHref} className="text-accent underline underline-offset-4">
            {copy.switchLabel}
          </Link>
        </p>
      </form>
    </main>
  );
}
