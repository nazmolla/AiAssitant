"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <Box sx={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
      <Card variant="outlined" sx={{ width: "100%", maxWidth: 420, mx: 2 }}>
        <CardContent sx={{ p: 4, textAlign: "center", display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: "error.main" }}>Access Denied</Typography>
          <Typography variant="body2" color="text.secondary">
            {error === "AccessDenied"
              ? "Your account is pending activation. An admin must activate your account before you can sign in."
              : `Authentication error: ${error}`}
          </Typography>
          <Link href="/" style={{ textDecoration: "none" }}>
            <Button variant="outlined">Back to Home</Button>
          </Link>
        </CardContent>
      </Card>
    </Box>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<Box sx={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>Loading...</Box>}>
      <AuthErrorContent />
    </Suspense>
  );
}
