import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { PageHeader } from "@/components/page-header";
import { getOnboardingSeed } from "@/data/onboarding";

export default async function OnboardingPage() {
  const seed = await getOnboardingSeed();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Resumable onboarding"
        title="Set up your executive assistant"
        description="Create your account, choose a plan, connect the services you use, and define the rules Ava must follow."
      />
      <OnboardingWizard initialState={seed} />
    </div>
  );
}
