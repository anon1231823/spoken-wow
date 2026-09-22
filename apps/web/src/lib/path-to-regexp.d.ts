// The copy of path-to-regexp Next compiles its own redirects and rewrites with, which
// locale-routes.test.ts matches against so the test agrees with the server. Next ships it
// without types; this is the one function the test calls.
declare module "next/dist/compiled/path-to-regexp" {
  export function match<P extends object>(
    path: string,
    options?: { decode?: (value: string) => string },
  ): (pathname: string) => false | { path: string; params: P };
}
