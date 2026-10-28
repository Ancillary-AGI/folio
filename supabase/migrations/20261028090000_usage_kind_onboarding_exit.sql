-- Widen the usage kind check for the guided tour.
--
-- The tour previously mirrored every exit as 'onboarding.complete', so a guide
-- closed on the first step was recorded as finished. 'onboarding.exit' now
-- carries the early exits, with the steps actually read in `detail`.
-- This is additive: no rows are rewritten and no history is reinterpreted.

alter table public.usage_events drop constraint if exists usage_events_kind_check;

alter table public.usage_events add constraint usage_events_kind_check check (kind in (
  'workspace.open', 'demo.load', 'project.create', 'project.open', 'vcs.commit',
  'export.run', 'simulation.run', 'agent.run', 'onboarding.complete', 'onboarding.exit', 'admin.open'
));
