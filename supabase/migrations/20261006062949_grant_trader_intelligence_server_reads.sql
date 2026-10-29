-- The intelligence builder runs only after the route authenticates the user,
-- then uses the service role with an explicit user_id filter. Earlier security
-- hardening revoked table reads, so grant only the columns this builder needs.
grant select (
  id,
  display_name,
  experience_level,
  trader_type,
  preferred_locale
) on table public.profiles to service_role;

grant select (
  id,
  user_id,
  analysis_id,
  response,
  category,
  comment,
  created_at
) on table public.contextual_analysis_feedback to service_role;
