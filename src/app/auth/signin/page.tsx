"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ type: "idle" | "error" | "success"; message?: string }>({ type: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLocalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus({ type: "idle" });
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/",
    });

    setIsSubmitting(false);

    if (result?.error) {
      const message =
        result.error === "CredentialsSignin"
          ? "Invalid email or password."
          : result.error;
      setStatus({ type: "error", message });
      return;
    }

    setStatus({ type: "success", message: "Signed in successfully." });
    router.push("/");
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Nexus Agent</CardTitle>
          <CardDescription>
            Sign in to access your sovereign personal AI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
          <Button
            className="w-full"
            variant="outline"
            onClick={() => signIn("azure-ad", { callbackUrl: "/" })}
          >
            Sign in with Azure AD
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={() => signIn("google", { callbackUrl: "/" })}
          >
            Sign in with Google
          </Button>
          </div>
          <div className="text-center text-xs uppercase tracking-wide text-muted-foreground">
            or use local credentials
          </div>
          <form className="space-y-3" onSubmit={handleLocalSubmit}>
            <Input
              type="email"
              name="email"
              placeholder="owner@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Input
              type="password"
              name="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in with Password"}
            </Button>
            {status.type !== "idle" && status.message ? (
              <p
                className={
                  status.type === "error"
                    ? "text-center text-sm text-destructive"
                    : "text-center text-sm text-emerald-600"
                }
              >
                {status.message}
              </p>
            ) : null}
            <p className="text-center text-xs text-muted-foreground">
              First-time owners can create their account by submitting an email + password here.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
