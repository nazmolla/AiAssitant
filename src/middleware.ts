import { withAuth } from "next-auth/middleware";

type OwnerToken = {
  sub?: string;
  ownerSub?: string;
};

export default withAuth({
  callbacks: {
    authorized: ({ token }) => {
      if (!token) return false;
      const ownerSub = (token as OwnerToken).ownerSub;
      if (!ownerSub) return false;
      return token.sub === ownerSub;
    },
  },
});

export const config = {
  matcher: [
    "/api/threads/:path*",
    "/api/approvals/:path*",
    "/api/knowledge/:path*",
    "/api/mcp/:path*",
    "/api/policies/:path*",
    "/api/logs/:path*",
  ],
};
