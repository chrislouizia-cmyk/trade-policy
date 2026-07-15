# Trade Police v14

## Customer portal
- Customer navigation contains trading functions only.
- Trade Police HQ is not linked or exposed in the client header.
- Greeting and Analyze Market now carry the dashboard hierarchy.

## Trade Police HQ
- Dedicated `/hq` portal with its own header, navigation and layout.
- Role-specific workspaces explain both available tools and protected data.
- Owner-only team directory supports individual permission overrides.
- Legacy `/admin` and `/staff/*` routes redirect to the dedicated HQ portal.

## Database
Run `012_staff_permission_controls.sql` after migration 011.
