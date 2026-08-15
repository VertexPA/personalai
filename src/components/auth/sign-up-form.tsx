"use client";

import { useActionState } from "react";
import Link from "next/link";

import {
  type AuthActionState,
  signUpWithPassword,
} from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = {};

export function SignUpForm() {
  const [state, action, isPending] = useActionState(signUpWithPassword, initialState);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full name</Label>
        <Input autoComplete="name" id="fullName" name="fullName" />
        {state.fieldErrors?.fullName?.map((error) => (
          <p className="text-xs text-destructive" key={error}>
            {error}
          </p>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input autoComplete="email" id="email" name="email" type="email" />
        {state.fieldErrors?.email?.map((error) => (
          <p className="text-xs text-destructive" key={error}>
            {error}
          </p>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input autoComplete="new-password" id="password" name="password" type="password" />
        {state.fieldErrors?.password?.map((error) => (
          <p className="text-xs text-destructive" key={error}>
            {error}
          </p>
        ))}
      </div>
      {state.message ? (
        <p className="text-sm text-muted-foreground">{state.message}</p>
      ) : null}
      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link className="font-medium text-primary hover:underline" href="/sign-in">
          Sign in
        </Link>
      </p>
    </form>
  );
}
