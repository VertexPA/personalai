"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthActionState {
  message?: string;
  fieldErrors?: {
    fullName?: string[];
    email?: string[];
    password?: string[];
  };
}

const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Enter at least 8 characters."),
});

const signUpSchema = signInSchema.extend({
  fullName: z.string().trim().min(2, "Enter your name."),
});

export async function signInWithPassword(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      message:
        "Supabase is not configured. Add the public URL and publishable key to enable sign-in.",
    };
  }

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { message: "We could not sign you in with those credentials." };
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  redirect("/sign-in");
}

export async function signUpWithPassword(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      message:
        "Supabase is not configured. Add the public URL and publishable key to enable account creation.",
    };
  }

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
      },
      emailRedirectTo: new URL("/auth/callback", process.env.APP_URL ?? "http://localhost:3000").toString(),
    },
  });

  if (error) {
    return { message: "We could not create that account. Please try again." };
  }

  return {
    message:
      "Account created. Check your email if confirmation is enabled, then continue to onboarding.",
  };
}
