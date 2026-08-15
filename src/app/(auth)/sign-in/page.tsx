import Link from "next/link";

import { SignInForm } from "@/components/auth/sign-in-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <Link className="flex items-center gap-2" href="/">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              A
            </span>
            <span className="font-semibold">Ava</span>
          </Link>
          <Badge className="mt-5 w-fit" variant="outline">
            Secure workspace access
          </Badge>
          <CardTitle className="mt-2 text-2xl">Welcome back</CardTitle>
          <CardDescription>
            Sign in to access your organization&apos;s executive assistant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}
