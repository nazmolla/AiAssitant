import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
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
