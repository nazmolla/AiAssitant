import NextAuth from "next-auth";
import { getAuthOptions } from "@/lib/auth/options";

/**
 * Dynamic handler — rebuilds provider list from DB on each request
 * so admin changes to OAuth providers take effect immediately.
 */
function handler(req: Request, ctx: { params: { nextauth: string[] } }) {
  const options = getAuthOptions();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (NextAuth as any)(req, ctx, options);
}

export { handler as GET, handler as POST };
