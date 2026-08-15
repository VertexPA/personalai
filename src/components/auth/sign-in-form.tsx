"use client";

import { useActionState } from "react";
import Link from "next/link";

import {
  type AuthActionState,
  signInWithPassword,
} from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: AuthActionState = {};

export function SignInForm() {
  const [state, action, isPending] = useActionState(signInWithPassword, initialState);

  return (
    <form action={action} className="space-y-4">
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
        <Input autoComplete="current-password" id="password" name="password" type="password" />
        {state.fieldErrors?.password?.map((error) => (
          <p className="text-xs text-destructive" key={error}>
            {error}
          </p>
        ))}
      </div>
      {state.message ? <p className="text-sm text-destructive">{state.message}</p> : null}
      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to Ava?{" "}
        <Link className="font-medium text-primary hover:underline" href="/sign-up">
          Create an account
        </Link>
      </p>
    </form>
  );
}
