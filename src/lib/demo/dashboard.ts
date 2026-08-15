import {
  demoAutomations,
  demoIntegrations,
  demoOrganization,
  demoSchedule,
  demoUsage,
} from "@/lib/demo/data";

export interface DashboardSnapshot {
  organization: typeof demoOrganization;
  schedule: typeof demoSchedule;
  integrations: typeof demoIntegrations;
  automations: typeof demoAutomations;
  usage: typeof demoUsage;
  isDemoMode: boolean;
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  return {
    organization: demoOrganization,
    schedule: demoSchedule,
    integrations: demoIntegrations,
    automations: demoAutomations,
    usage: demoUsage,
    isDemoMode: true,
  };
}
