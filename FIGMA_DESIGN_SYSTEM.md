# Figma and design system workflow

## Design system

The current interface uses shadcn/ui source components, Tailwind CSS variables, Geist typography, and centralized semantic tokens in src/app/globals.css.

Core reusable components include:

- Button
- Input
- Select
- Textarea
- Card
- Badge
- Avatar
- Table
- Dialog
- AlertDialog
- Sheet
- Tabs
- Tooltip

Product-level compositions include:

- AppShell
- PageHeader
- MetricCard
- ScheduleCard
- TravelWarning
- Integration cards
- Approval cards
- Onboarding wizard

## Token mapping

| Token family | Purpose |
| --- | --- |
| background, foreground, card | Main surfaces |
| primary, secondary, accent | Primary actions and restrained emphasis |
| muted, border, input, ring | Structure and interaction states |
| sidebar | Navigation shell |
| radius | Corner-radius scale |
| Geist and Geist Mono | Interface and metric/code typography |

The UI supports light and dark token definitions. The polished initial surface is the calm, executive light workspace with a dark navigation rail.

## Figma workflow

1. Create Figma components corresponding to the reusable primitives and product-level cards.
2. Create variants for default, hover, active, disabled, loading, success, warning, error, locked, connected, disconnected, and pending states where appropriate.
3. Map Figma variables to the semantic CSS tokens, rather than hard-coding hex colors into individual components.
4. Use the existing dashboard as an implementation reference, not as a constraint on future visual work.
5. After a Figma redesign is approved, update only the component and styling layer. Keep database schema, APIs, authorization, entitlements, integrations, approval logic, and agent logic independent.

## Responsive behavior

- Desktop uses the persistent navigation rail and high-density operational tables.
- Tablet collapses layouts into two-column and single-column card grids.
- Mobile uses a compact horizontal navigation strip and stacked dashboard content.

Avoid product-dashboard anti-patterns: decorative gradients, excessive motion, nested cards, and UI that hides security or integration state. Locked and mock features should be clear without being intrusive.
