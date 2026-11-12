-- Widen the usage kind check for community template forks.
--
-- 'template.fork' records that a designer forked a shared design into their
-- own workspace — a signal the operator console reports on. The constraint is
-- dropped and recreated, which rewrites nothing: no row changes, no history is
-- reinterpreted, and deployments apply this cleanly after the onboarding widen.

alter table public.usage_events drop constraint if exists usage_events_kind_check;

alter table public.usage_events add constraint usage_events_kind_check check (kind in (
  'workspace.open', 'demo.load', 'project.create', 'project.open', 'vcs.commit',
  'export.run', 'simulation.run', 'agent.run', 'onboarding.complete', 'onboarding.exit',
  'admin.open', 'template.fork'
));
