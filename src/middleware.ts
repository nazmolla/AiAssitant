import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => {
      if (!token) return false;
      // Multi-user: any authenticated user with a userId is allowed
      const userId = (token as Record<string, unknown>).userId;
      return !!userId;
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
    "/api/config/:path*",
    "/api/attachments/:path*",
  ],
};
