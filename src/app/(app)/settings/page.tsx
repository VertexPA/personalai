import { AssistantRulesManager } from "@/components/settings/assistant-rules-manager";
import { WorkspaceSettingsEditor } from "@/components/settings/workspace-settings-editor";
import { PageHeader } from "@/components/page-header";
import { getAssistantRules } from "@/data/assistant-rules";
import { getWorkspaceSettings } from "@/data/workspace-settings";

export default async function SettingsPage() {
  const [settings, rules] = await Promise.all([
    getWorkspaceSettings(),
    getAssistantRules(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          settings.mode === "demo"
            ? "Development settings preview"
            : "Organization settings"
        }
        title="Settings"
        description="Assistant rules, timezone, working hours, notification preferences, and approval defaults are tenant-scoped."
      />
      <WorkspaceSettingsEditor initialState={settings} />
      <AssistantRulesManager
        canManage={rules.canManage}
        hasWorkspace={rules.hasWorkspace}
        rules={rules.rules}
      />
    </div>
  );
}
