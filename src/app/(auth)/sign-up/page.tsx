import Link from "next/link";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignUpPage() {
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
            Create your workspace
          </Badge>
          <CardTitle className="mt-2 text-2xl">Start with Ava</CardTitle>
          <CardDescription>
            You will create an organization and connect your tools in the guided
            onboarding flow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm />
        </CardContent>
      </Card>
    </main>
  );
}
