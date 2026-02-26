"use client";

import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Suspense } from "react";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="flex h-screen items-center justify-center bg-background noise relative overflow-hidden">
      <div className="absolute top-1/3 left-1/3 w-72 h-72 bg-destructive/5 rounded-full blur-3xl" />
      <Card className="w-full max-w-md relative z-10">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-display text-destructive">Access Denied</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            {error === "AccessDenied"
              ? "Your account is pending activation. An admin must activate your account before you can sign in."
              : `Authentication error: ${error}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Link href="/">
            <Button variant="outline">Back to Home</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
      <AuthErrorContent />
    </Suspense>
  );
}
