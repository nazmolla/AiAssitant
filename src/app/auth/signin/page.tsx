"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn, getProviders } from "next-auth/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";

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
          : result.error.includes("ACCOUNT_PENDING")
            ? "Your account has been created but is pending activation. An admin must activate your account before you can sign in."
            : result.error;
      setStatus({ type: "error", message });
      return;
    }

    setStatus({ type: "success", message: "Signed in successfully." });
    router.push("/");
  }

  return (
    <Box sx={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
      <Card variant="outlined" sx={{ width: "100%", maxWidth: 420, mx: 2 }}>
        <CardContent sx={{ p: 4, display: "flex", flexDirection: "column", gap: 3 }}>
          <Box sx={{ textAlign: "center" }}>
            <Typography variant="h4" sx={{ fontWeight: 700, color: "primary.main" }}>Nexus</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Sign in to access your sovereign personal AI.
            </Typography>
          </Box>
          {oauthProviders.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {oauthProviders.map((provider) => (
                <Button
                  key={provider.id}
                  fullWidth
                  variant="outlined"
                  onClick={() => signIn(provider.id, { callbackUrl: "/" })}
                >
                  Sign in with {provider.name}
                </Button>
              ))}
            </Box>
          )}
          {oauthProviders.length > 0 && (
            <Divider>
              <Typography variant="caption" color="text.disabled">or use local credentials</Typography>
            </Divider>
          )}
          <form method="post" style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={handleLocalSubmit}>
            <TextField
              type="email"
              name="email"
              placeholder="owner@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              size="small"
              fullWidth
            />
            <TextField
              type="password"
              name="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              size="small"
              fullWidth
            />
            <Button fullWidth variant="contained" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in with Password"}
            </Button>
            {status.type !== "idle" && status.message && (
              <Alert severity={status.type === "error" ? "error" : "success"} sx={{ fontSize: "0.8rem" }}>
                {status.message}
              </Alert>
            )}
            <Typography variant="caption" color="text.disabled" sx={{ textAlign: "center" }}>
              New users can register by submitting an email + password. Your account will be pending until an admin activates it.
            </Typography>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
