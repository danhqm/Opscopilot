"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authenticate, restoreSession } from "@/lib/api";

type AuthMode = "login" | "signup";

export function AuthPanel() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<AuthMode | "restore" | null>("restore");

  useEffect(() => {
    let active = true;
    void restoreSession()
      .then((user) => {
        if (active && user) router.replace("/workspace");
      })
      .finally(() => {
        if (active) setPendingMode(null);
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function submit(mode: AuthMode, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPendingMode(mode);

    const form = new FormData(event.currentTarget);
    try {
      await authenticate(mode, String(form.get("email")), String(form.get("password")));
      router.push("/workspace");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed.");
      setPendingMode(null);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-8">
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Encrypted session access
        </div>
        <h2 className="text-3xl font-semibold tracking-tight">Enter your workspace</h2>
        <p className="mt-2 text-base leading-7 text-muted-foreground">
          Use an existing account or create one to initialize your operations environment.
        </p>
      </div>

      <Card className="border-border/80 bg-card/70 shadow-2xl shadow-black/25 backdrop-blur">
        <CardContent className="pt-6">
          <Tabs defaultValue="login" onValueChange={() => setError(null)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            {error ? (
              <Alert variant="destructive" className="mt-5">
                <AlertTitle>Couldn&apos;t continue</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <TabsContent value="login" className="pt-6">
              <AuthForm mode="login" pending={pendingMode !== null} onSubmit={(event) => void submit("login", event)} />
            </TabsContent>
            <TabsContent value="signup" className="pt-6">
              <AuthForm mode="signup" pending={pendingMode !== null} onSubmit={(event) => void submit("signup", event)} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      <p className="mt-5 text-center text-sm leading-6 text-muted-foreground">
        Access tokens expire quickly. Refresh sessions are stored in secure, HTTP-only cookies.
      </p>
    </div>
  );
}

function AuthForm({
  mode,
  pending,
  onSubmit,
}: {
  mode: AuthMode;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isSignup = mode === "signup";

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor={`${mode}-email`}>Work email</Label>
        <Input id={`${mode}-email`} name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`${mode}-password`}>Password</Label>
          <span className="text-xs text-muted-foreground">10+ characters</span>
        </div>
        <Input id={`${mode}-password`} name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={10} required />
      </div>
      <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {pending ? "Securing session…" : isSignup ? "Create workspace account" : "Continue to workspace"}
        {pending ? null : <ArrowRight data-icon="inline-end" />}
      </Button>
    </form>
  );
}
