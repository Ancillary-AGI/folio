/*
  Community templates — drop the not-really-a-licence column

  Publishing a design grants it to the community; the fork path already keeps
  attribution to the author and never relicenses anyone's copy away from them.
  A CC-BY/CC0 declaration did no work here: nothing enforced it, nothing
  displayed it honestly, and "attribution required" on a payload whose author
  field is plain text was not a licence anyone could act on. The payload's
  authorName is the attribution that everyone actually sees; that behaviour
  stays exactly as it is.
*/

alter table public.community_projects
  drop constraint if exists community_projects_license_check;

alter table public.community_projects
  drop column if exists license;
