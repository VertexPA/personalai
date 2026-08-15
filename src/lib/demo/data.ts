import type {
  ApprovalPolicy,
  CustomerEntitlementOverride,
  MembershipRole,
  PlanEntitlement,
} from "@/lib/domain/types";
import type { CalendarEvent } from "@/lib/calendar/conflicts";

export const demoOrganization = {
  id: "f6fef9f5-3e6d-4701-8d19-1e7ca2ed1471",
  name: "Tan Executive Office",
  slug: "tan-executive-office",
  plan: "Executive",
  status: "active",
  timezone: "Asia/Kuala_Lumpur",
  userName: "John Tan",
  role: "customer_owner" as MembershipRole,
};

export const demoUser = {
  id: "0ea5021e-9db5-4111-a8e8-25b7218687a8",
  fullName: "John Tan",
  role: "customer_owner" as MembershipRole,
};

export const demoPlanEntitlements: PlanEntitlement[] = [
  { feature: "calendar", enabled: true, limit: null, configuration: {} },
  {
    feature: "calendar_management",
    enabled: true,
    limit: null,
    configuration: {},
  },
  { feature: "multi_calendar", enabled: true, limit: 4, configuration: {} },
  { feature: "whatsapp", enabled: true, limit: null, configuration: {} },
  { feature: "telegram", enabled: true, limit: null, configuration: {} },
  { feature: "gmail", enabled: true, limit: null, configuration: {} },
  { feature: "morning_brief", enabled: true, limit: null, configuration: {} },
  { feature: "basic_travel", enabled: true, limit: null, configuration: {} },
  { feature: "live_traffic", enabled: true, limit: null, configuration: {} },
  {
    feature: "travel_aware_scheduling",
    enabled: true,
    limit: null,
    configuration: {},
  },
  {
    feature: "smart_rescheduling",
    enabled: true,
    limit: null,
    configuration: {},
  },
  {
    feature: "conflict_detection",
    enabled: true,
    limit: null,
    configuration: {},
  },
  {
    feature: "attendee_notifications",
    enabled: true,
    limit: null,
    configuration: {},
  },
  { feature: "voice_messages", enabled: true, limit: null, configuration: {} },
  { feature: "basic_memory", enabled: true, limit: null, configuration: {} },
  {
    feature: "advanced_memory",
    enabled: true,
    limit: null,
    configuration: {},
  },
  {
    feature: "meeting_buffers",
    enabled: true,
    limit: null,
    configuration: {},
  },
];

export const demoCustomerOverrides: CustomerEntitlementOverride[] = [
  {
    feature: "slack",
    enabled: true,
    limit: null,
    configuration: { addon: true, addedBy: "platform_admin" },
    expiresAt: null,
  },
];

export const demoApprovalPolicies: ApprovalPolicy[] = [
  { action: "calendar.read", required: false, conditions: {} },
  { action: "travel.read", required: false, conditions: {} },
  { action: "schedule.recommend", required: false, conditions: {} },
  { action: "reminder.create", required: false, conditions: {} },
  { action: "calendar.create_external", required: true, conditions: {} },
  { action: "calendar.move_external", required: true, conditions: {} },
  { action: "calendar.cancel", required: true, conditions: {} },
  { action: "email.send", required: true, conditions: {} },
  { action: "notification.send_external", required: true, conditions: {} },
];

export const demoSchedule: CalendarEvent[] = [
  {
    id: "meeting-management",
    title: "Management Meeting",
    startsAt: new Date("2026-08-11T09:00:00+08:00"),
    endsAt: new Date("2026-08-11T10:00:00+08:00"),
    location: "Menara UOA, Bangsar",
  },
  {
    id: "lunch-jason",
    title: "Lunch with Jason",
    startsAt: new Date("2026-08-11T11:30:00+08:00"),
    endsAt: new Date("2026-08-11T13:15:00+08:00"),
    location: "Bangsar Shopping Centre",
  },
  {
    id: "supplier",
    title: "Supplier Meeting",
    startsAt: new Date("2026-08-11T14:00:00+08:00"),
    endsAt: new Date("2026-08-11T15:00:00+08:00"),
    location: "KL Eco City",
  },
  {
    id: "product-review",
    title: "Product Review",
    startsAt: new Date("2026-08-11T16:30:00+08:00"),
    endsAt: new Date("2026-08-11T17:15:00+08:00"),
    location: "Google Meet",
  },
];

export const demoIntegrations = [
  {
    name: "Google Calendar",
    status: "connected",
    detail: "3 selected calendars · synced 3 min ago",
    feature: "calendar",
    mode: "mock",
  },
  {
    name: "WhatsApp",
    status: "ready",
    detail: "Cloud API adapter ready · credentials required",
    feature: "whatsapp",
    mode: "not_configured",
  },
  {
    name: "Telegram",
    status: "ready",
    detail: "Bot adapter ready · token required",
    feature: "telegram",
    mode: "not_configured",
  },
  {
    name: "Gmail",
    status: "available",
    detail: "Included with Executive · OAuth connection required",
    feature: "gmail",
    mode: "not_configured",
  },
  {
    name: "Slack",
    status: "available",
    detail: "Enabled by a customer add-on · OAuth connection required",
    feature: "slack",
    mode: "not_configured",
  },
  {
    name: "Google Routes",
    status: "mock",
    detail: "Development provider in use · Maps key required",
    feature: "live_traffic",
    mode: "mock",
  },
] as const;

export const demoAutomations = [
  {
    name: "Daily Morning Brief",
    schedule: "Every weekday · 7:30 AM",
    timezone: "Asia/Kuala_Lumpur",
    status: "active",
    nextRun: "Tomorrow at 7:30 AM",
  },
  {
    name: "Travel Departure Reminder",
    schedule: "Before location-based meetings",
    timezone: "Asia/Kuala_Lumpur",
    status: "active",
    nextRun: "Today at 12:37 PM",
  },
] as const;

export const demoUsage = [
  { label: "Agent runs", used: 86, limit: 500, unit: "runs" },
  { label: "Calendar operations", used: 191, limit: 2_000, unit: "operations" },
  { label: "Travel lookups", used: 37, limit: 500, unit: "lookups" },
  { label: "Messages", used: 54, limit: 1_000, unit: "messages" },
];
