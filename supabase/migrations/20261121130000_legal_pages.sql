/*
  # Legal and company pages

  The public site's about, terms, privacy and security pages are operator-owned
  copy, not build-time constants. They live here so an operator can change them
  without a redeploy, and so a deployment that has never been configured still
  renders something truthful.

  Reading is free for anyone: this is marketing and legal copy, by design, and
  is not scoped by owner. Writing requires the `content.manage` capability, so
  the same operator role that owns the FAQ and testimonials owns this copy.

  `sections` is a jsonb array of `{ heading, body }` objects, where `body` is a
  rich-text document: paragraphs, sub-headings, lists, quotes and inline runs
  (bold, italic, underline, strike, code, and http(s)/mailto links). The
  public renderer builds React elements from that structure. No HTML string is
  stored or injected, so an operator cannot introduce markup the renderer has
  not modelled.

  Seeding is per-slug (`on conflict do nothing`) rather than all-or-nothing: a
  re-applied migration fills in a page that is missing without overwriting edits
  an operator has already made.

  Quoting: SQL string values use single quotes, with an apostrophe inside doubled.
  The JSON documents use dollar-quoting so the apostrophes in the prose need no
  escaping at all. Double quotes are identifiers in PostgreSQL and must never
  wrap a value.
*/

create table if not exists public.legal_pages (
  slug text primary key,
  title text not null,
  eyebrow text not null,
  heading text not null,
  lede text not null,
  sections jsonb not null default $json$[]$json$::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.legal_pages is
  'Operator-editable copy for the public about, terms, privacy and security pages.';

alter table public.legal_pages enable row level security;

drop policy if exists "Legal pages are readable by anyone" on public.legal_pages;
create policy "Legal pages are readable by anyone"
  on public.legal_pages for select
  using (true);

drop policy if exists "Operators can insert a legal page" on public.legal_pages;
create policy "Operators can insert a legal page"
  on public.legal_pages for insert
  with check (public.has_capability('content.manage'));

drop policy if exists "Operators can edit a legal page" on public.legal_pages;
create policy "Operators can edit a legal page"
  on public.legal_pages for update
  using (public.has_capability('content.manage'))
  with check (public.has_capability('content.manage'));

drop policy if exists "Operators can delete a legal page" on public.legal_pages;
create policy "Operators can delete a legal page"
  on public.legal_pages for delete
  using (public.has_capability('content.manage'));

grant select on public.legal_pages to authenticated, anon;
grant insert, update, delete on public.legal_pages to authenticated;

-- Seed only the pages that are missing. `on conflict do nothing` keeps an
-- operator's edit when the migration is re-applied.
insert into public.legal_pages (slug, title, eyebrow, heading, lede, sections) values
  (
    'about',
    'About',
    'About Folio',
    E'One brief in.\nOne verified board out.',
    'Folio is an engineering workbench for circuits, printed circuit boards, mechanical, RF and robotics designs. A brief becomes a simulated, routed, fabricable board — with the checks run before anyone spends money.',
    $json$[
  {
    "heading": "What Folio is",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "A single instrument, not a pile of tools: the schematic captures the design, the simulation runs after every edit, the board routes on the real geometry, and the fab package only leaves when the DRC is clean. Every stage — schematic, simulation, PCB, 3-D model, BOM, fab export — is the same project and the same files, not a copy shuffled between applications."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "The engines are real: MNA with Newton-Raphson companion stamps for the transient and operating point, a rip-up-and-retry A* router against the declared nets, DRC violations measured at the geometry that causes them, and a fab package whose Gerbers are CRC-verified. Where Folio cannot verify a thing, it says so instead of drawing it anyway."
          }
        ]
      }
    ]
  },
  {
    "heading": "Who builds Folio",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Folio is a product of X Industries — built by the team that ships it, without outside funding theatrics or growth-at-all-costs robotics."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Questions, feedback, or a design you want to see work: get in touch below."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "founder@folio.dev",
            "href": "mailto:founder@folio.dev"
          }
        ]
      }
    ]
  },
  {
    "heading": "What it refuses to do",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Folio does not invent component values with no source, claim a simulation passed when it has not, or produce a board it cannot route and call it routed. The agent drafts; the engines verify; you review before a fab house sees it. When something cannot be verified, Folio says what it does not know."
          }
        ]
      }
    ]
  }
]$json$::jsonb
  ),
  (
    'terms',
    'Terms',
    'Terms of service',
    E'Your work is yours.\nHere is what that means.',
    'The plain terms for using Folio: what you keep, what the software does and does not promise, and how this page can change.',
    $json$[
  {
    "heading": "Using Folio",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "You may use Folio to design, simulate, route and export engineering work, for your own projects or for clients. The offline build runs on your machine with no account and no server; it is free and stays free."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "The online build, when a deployment provides one, is governed by whoever operates that deployment. This page describes the software and the hosted service this installation runs."
          }
        ]
      }
    ]
  },
  {
    "heading": "Your designs are yours",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "You keep every right in the designs you create. Folio claims no licence over your schematics, layouts, models, exports or documentation, and it does not upload them anywhere unless you explicitly publish or export them."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Exports are plain files — Gerber, Excellon, CSV, STEP — that you can read, archive and hand to a fabricator without this software."
          }
        ]
      }
    ]
  },
  {
    "heading": "Community designs",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Publishing to the community is opt-in and per design. When you publish, you grant other users permission to view, fork and build on that design, and you confirm you have the right to share it. You can remove a published design at any time; removal stops future display but cannot retract copies others have already forked."
          }
        ]
      }
    ]
  },
  {
    "heading": "Verification, and its limits",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Folio runs real engines — a modified-nodal-analysis circuit solver, a grid router, design-rule checks — and reports what they find. The agent drafts; the engines verify; a qualified engineer reviews. Nothing the agent proposes is a substitute for that review."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Simulation results describe a model of a circuit under stated assumptions. They are not a guarantee that a physical board will behave the same way, and they are not a substitute for testing, measurement or a manufacturer's own validation."
          }
        ]
      }
    ]
  },
  {
    "heading": "Not for safety-critical use without review",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Folio is a design tool. It is not certified for medical, aerospace, nuclear, automotive safety or other safety-critical applications, and it must not be used as the sole basis for a design where failure could injure someone or damage property. Have the output reviewed and validated by a qualified engineer who takes responsibility for it."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "If you intend to use Folio in a regulated domain, you are responsible for meeting that domain's requirements; this software does not claim to."
          }
        ]
      }
    ]
  },
  {
    "heading": "Acceptable use",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Do not use the hosted service to break the law, to infringe someone else's rights, to attack or overload the deployment, or to publish designs you have no right to share. An operator may suspend an account that abuses the service; the audit trail records that action."
          }
        ]
      }
    ]
  },
  {
    "heading": "Warranty",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Folio is provided as is, without warranty of any kind. The offline build is a tool you run on your own machine; you are responsible for backing up your work and for verifying anything you build from it."
          }
        ]
      }
    ]
  },
  {
    "heading": "Changes to these terms",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "This page changes with the code, visibly and in the repository, and never retroactively. If a change matters to how you use Folio, it is stated here before it takes effect."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "founder@folio.dev",
            "href": "mailto:founder@folio.dev"
          }
        ]
      }
    ]
  }
]$json$::jsonb
  ),
  (
    'privacy',
    'Privacy',
    'Privacy',
    E'Local first.\nNothing to leak.',
    'Folio stores your designs on your machine, not ours. There is no profile of you for us to hold, because the offline build has no server to hold it on.',
    $json$[
  {
    "heading": "Where your data lives",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Projects, checkpoints, branches, exports and settings live in this browser's local storage on this machine. Exports are plain files — Gerber, Excellon, CSV, STEP — in the directory you chose. Deleting them is deleting them: there is no shadow copy, because there is nowhere for a shadow copy to live."
          }
        ]
      }
    ]
  },
  {
    "heading": "What we collect",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "In the offline build: nothing. No analytics, no crash reporting, no fingerprinting, no advertising pixels, no telemetry of any kind. Nothing leaves your machine except the files you export and the projects you choose to publish to the community, if you do."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Fonts are self-hosted. There is no third-party script anywhere in the static shells, no CDN, no Google Fonts. The pages you load are the pages we ship."
          }
        ]
      }
    ]
  },
  {
    "heading": "Online mode, if you run it",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "The online build signs users in against the Supabase instance you deploy it on — your database, your region, your rules. We host nothing, because we operate nothing. If a hosted offering ever exists, this page changes with the code — visibly, in the repository — and never retroactively."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Where an online build runs, the operator holds the account directory, the usage ledger and the audit trail for that deployment, and is the contact for questions about them."
          }
        ]
      }
    ]
  },
  {
    "heading": "Your rights",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "You can export everything, at any time, to plain files. You can delete your local storage and the export folders and be fully erased — we hold nothing to erase. Your projects are yours, your exports are yours, and nothing about that changes when Folio ships a new version."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Questions or takedown requests for community designs: get in touch below."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "founder@folio.dev",
            "href": "mailto:founder@folio.dev"
          }
        ]
      }
    ]
  }
]$json$::jsonb
  ),
  (
    'security',
    'Security',
    'Security',
    E'Your design never leaves\nthe machine unless\nyou ask it to.',
    'Folio is local-first. There is no copy of your schematic on someone else''s server, because there is no server in the offline build at all.',
    $json$[
  {
    "heading": "Offline by default",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "The standalone build runs entirely in your browser or as the app bundle: projects, checkpoints and exports live in this machine's local storage and on your disk. No license server, no phone-home check, no telemetry service, no crash reporter — there is nowhere for data to go, and nothing listening."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Exports are plain files you control: Gerber RS-274X, Excellon with span support, centroid CSV, a BOM with lifecycle status. Fabrication downloads are the same bytes, CRC-verified, that land on your disk."
          }
        ]
      }
    ]
  },
  {
    "heading": "Verification is part of the build",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "The release gate is npm run verify and it fails the build. It runs type-check, strict lint with zero allowed warnings, accessibility checks, and thousands of assertions across hundreds of test files — the same suites that pin solver output against closed-form references and the DRC against known-bad geometry."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "The full test suite is one command, and it either passes as a whole or it does not merge. No cached greens, no partial runs presented as green."
          }
        ]
      }
    ]
  },
  {
    "heading": "Supply chain",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Production dependencies are audited with npm audit. Fonts are self-hosted — no CDN type providers. The build can emit a Content-Security-Policy with a per-request nonce and strict-dynamic, no unsafe-inline for scripts, and frame-ancestors set to none; the only permitted script origin is the self host."
          }
        ]
      }
    ]
  },
  {
    "heading": "Reporting a vulnerability",
    "body": [
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Found a way in? Write to the address below. Reports are read by the person who owns the codebase and triaged as engineering work, not by an autoresponder. The repository's security policy is public."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "Folio is a product of X Industries. There is no separate program, no bounty and no deadline you will be graded on — just a direct line and an honest read."
          }
        ]
      },
      {
        "type": "paragraph",
        "runs": [
          {
            "text": "founder@folio.dev",
            "href": "mailto:founder@folio.dev"
          },
          {
            "text": " · "
          },
          {
            "text": "SECURITY.md",
            "href": "https://github.com/Ancillary-AGI/folio/blob/main/SECURITY.md"
          }
        ]
      }
    ]
  }
]$json$::jsonb
  )
on conflict (slug) do nothing;