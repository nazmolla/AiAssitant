"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn, getProviders } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const PROVIDER_LABELS: Record<string, string> = {
  "azure-ad": "Azure AD",
  google: "Google",
};

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ type: "idle" | "error" | "success"; message?: string }>({ type: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [oauthProviders, setOauthProviders] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    getProviders().then((providers) => {
      if (!providers) return;
      const oauth = Object.values(providers).filter((p) => p.id !== "credentials");
      setOauthProviders(oauth.map((p) => ({ id: p.id, name: PROVIDER_LABELS[p.id] || p.name })));
    });
  }, []);

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
    <div className="flex h-screen items-center justify-center bg-background noise relative overflow-hidden">
      <div className="absolute top-1/3 left-1/3 w-72 h-72 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/3 right-1/3 w-72 h-72 bg-primary/3 rounded-full blur-3xl" />
      <Card className="w-full max-w-md relative z-10">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-display gradient-text">Nexus</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Sign in to access your sovereign personal AI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {oauthProviders.length > 0 && (
            <div className="space-y-3">
              {oauthProviders.map((provider) => (
                <Button
                  key={provider.id}
                  className="w-full"
                  variant="outline"
                  onClick={() => signIn(provider.id, { callbackUrl: "/" })}
                >
                  Sign in with {provider.name}
                </Button>
              ))}
            </div>
          )}
          {oauthProviders.length > 0 && (
            <div className="text-center text-[10px] uppercase tracking-widest text-muted-foreground/40 font-medium">
              or use local credentials
            </div>
          )}
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
                    ? "text-center text-sm text-red-400"
                    : "text-center text-sm text-green-400"
                }
              >
                {status.message}
              </p>
            ) : null}
            <p className="text-center text-[11px] text-muted-foreground/50 font-light">
              First-time owners can create their account by submitting an email + password here.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
