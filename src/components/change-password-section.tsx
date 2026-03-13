"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const LABEL_CLASS = "text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider";

export function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isLocalUser, setIsLocalUser] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/admin/users/me")
      .then((r) => r.json())
      .then((d) => { setIsLocalUser(d?.provider_id === "local"); })
      .catch(() => setIsLocalUser(false));
  }, []);

  if (isLocalUser === null || isLocalUser === false) return null;

  const labelClass = LABEL_CLASS;

  const handleSubmit = async () => {
    setMessage(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ type: "error", text: "All fields are required." });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: "error", text: "New password must be at least 8 characters." });
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setMessage({ type: "error", text: "New password must contain at least one uppercase letter." });
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setMessage({ type: "error", text: "New password must contain at least one lowercase letter." });
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setMessage({ type: "error", text: "New password must contain at least one digit." });
      return;
    }
    if (!/[^A-Za-z0-9]/.test(newPassword)) {
      setMessage({ type: "error", text: "New password must contain at least one special character." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New passwords do not match." });
      return;
    }

    setChanging(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Password changed successfully." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to change password." });
      }
    } catch {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setChanging(false);
    }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="text-lg font-display">Change Password</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Current Password</label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className={labelClass}>New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className={labelClass}>Confirm New Password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/50">
          Password must be at least 8 characters. Only available for local accounts.
        </p>
        {message && (
          <p className={`text-sm ${message.type === "success" ? "text-green-400" : "text-red-400"}`}>
            {message.text}
          </p>
        )}
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={changing} variant="outline">
            {changing ? "Changing…" : "Change Password"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
