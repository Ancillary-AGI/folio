/**
 * Roles and access — the console's IAM surface.
 *
 * Two things are being shown, and they are deliberately distinct:
 *
 *   1. The role matrix. It is product-defined and server-enforced through
 *      `role_capabilities` and `has_capability()`, so it is read here, not
 *      invented in the browser.
 *   2. Who holds each role. That is editable, audited, and bounded by the same
 *      rules the database trigger applies: an administrator cannot grant the
 *      owner role or change an owner, and nobody can remove their own access.
 *
 * The console cannot invite an account: that needs the identity service's
 * admin API and a service-role key, which must never reach a browser. The
 * panel says so rather than showing an invitation form that cannot work.
 */
import { Check, Lock, Minus, ShieldCheck, UserCog, Users } from 'lucide-react'
import type { AccessModel, Account } from '../lib/admin/adminService'
import type { Operator } from '../lib/admin/operatorSession'
import {
  ADMIN_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type AdminRole,
} from '../lib/admin/quotaPolicy'
import {
  CAPABILITY_DEFINITIONS, isConsoleRole, ROLE_CAPABILITIES, type Capability,
} from '../lib/admin/permissions'
import { Alert, Card, EmptyState, Kpi, SectionHeader, StatusChip } from './shared'
import { formatTime, roleLabel } from './format'

export interface IamPanelProps {
  operator: Operator
  accounts: Account[]
  access: AccessModel | null
  busyAccount: string
  onChangeRole: (account: Account, role: AdminRole) => void
  onOpenAccounts: () => void
}

function grantsFor(role: AdminRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role]
}

export default function IamPanel({
  operator,
  accounts,
  access,
  busyAccount,
  onChangeRole,
  onOpenAccounts,
}: IamPanelProps) {
  const operators = accounts.filter((account) => isConsoleRole(account.role))
  const owners = accounts.filter((account) => account.role === 'owner')
  const admins = accounts.filter((account) => account.role === 'admin')
  const unassigned = accounts.filter((account) => account.role === 'user')
  const canManageOwners = operator.role === 'owner'
  const grants = (role: AdminRole) => access?.grants[role] ?? grantsFor(role)

  return (
    <section role="tabpanel" id="admin-panel-iam" aria-labelledby="admin-tab-iam" className="space-y-4">
      <SectionHeader
        title="Roles & access"
        detail="Who may operate this deployment, what each built-in role grants, and where the boundary actually sits. The matrix is read from the deployment; the database trigger enforces it on every role change."
      >
        <span className="cad-chip border-primary/40 bg-primary/10 text-primary">{`${operator.name} · ${ROLE_LABELS[operator.role]}`}</span>
        <button type="button" className="cad-ctl" onClick={onOpenAccounts}>Manage all accounts</button>
      </SectionHeader>

      {access?.error && (
        <Alert tone="warning">
          {`The server capability table could not be read, so the built-in matrix is shown: ${access.error}. Apply the capability IAM migration to make the grants server-visible.`}
        </Alert>
      )}
      {access && !access.error && access.source === 'server' && (
        <p className="text-[11px] text-muted-foreground">
          Grants below were read from <code>role_capabilities</code>; the same table backs <code>has_capability()</code> in the profile guard.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Owners" value={String(owners.length)} hint="Can grant the owner role and change an owner" icon={ShieldCheck} tone="primary" />
        <Kpi label="Administrators" value={String(admins.length)} hint="Can manage accounts, policy, content and the newsletter" icon={UserCog} tone="amber" />
        <Kpi label="Console operators" value={String(operators.length)} hint={`${operators.filter((account) => account.status === 'active').length} active · ${operators.filter((account) => account.status === 'suspended').length} suspended`} icon={Users} tone="success" />
        <Kpi label="Unassigned" value={String(unassigned.length)} hint="Governed by the viewer policy until a role is set" icon={Lock} tone="muted" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Your authority</h3>
            <p className="text-[11px] text-muted-foreground">
              {`The console checks these grants before it offers an action; the deployment checks them again before it accepts one.`}
            </p>
          </div>
          <span className="cad-chip">{`${grants(operator.role).length} of ${CAPABILITY_DEFINITIONS.length} capabilities`}</span>
        </div>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {CAPABILITY_DEFINITIONS.map((definition) => {
            const granted = grants(operator.role).includes(definition.id)
            return (
              <li key={definition.id} className="flex items-start gap-2 text-[11px]">
                <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border ${granted
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-border bg-muted text-muted-foreground'}`}>
                  {granted ? <Check className="h-3 w-3" aria-hidden="true" /> : <Minus className="h-3 w-3" aria-hidden="true" />}
                </span>
                <span className={granted ? 'text-foreground' : 'text-muted-foreground'}>
                  {definition.label}
                  <span className="sr-only">{granted ? ' granted' : ' not granted'}</span>
                  {definition.ownerOnly && <span className="ml-1 text-[10px] text-muted-foreground">owner only</span>}
                </span>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Console access</h3>
            <p className="text-[11px] text-muted-foreground">
              Only the owner and administrator roles open the console. Revoking access demotes the account to engineer; its work is kept.
            </p>
          </div>
          <span className="cad-chip">{`${operators.length} operator${operators.length === 1 ? '' : 's'}`}</span>
        </div>

        {operators.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No operator accounts" detail="Promote an account from the Accounts section. New sign-ups start as viewers." />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="admin-table min-w-[720px]">
              <caption className="sr-only">Accounts that can open the operator console</caption>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Access</th>
                </tr>
              </thead>
              <tbody>
                {operators.map((account) => {
                  const self = account.id === operator.id
                  const locked = self || (account.role === 'owner' && !canManageOwners)
                  const busy = busyAccount === account.id
                  return (
                    <tr key={account.id}>
                      <td>
                        <p className="font-medium text-foreground">{account.name}{self ? ' (you)' : ''}</p>
                        <p className="text-[10px] text-muted-foreground">{account.email || 'No email on record'}</p>
                      </td>
                      <td>
                        {locked ? (
                          <span className="text-foreground">
                            {roleLabel(account.role)}
                            {self && <span className="ml-1 text-[10px] text-muted-foreground">your access</span>}
                          </span>
                        ) : (
                          <select
                            aria-label={`Console role for ${account.name}`}
                            className="min-h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                            value={account.role}
                            disabled={busy}
                            onChange={(event) => onChangeRole(account, event.target.value as AdminRole)}
                          >
                            {ADMIN_ROLES.filter((role) => role !== 'owner' || canManageOwners).map((role) => (
                              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td><StatusChip status={account.status} /></td>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(account.lastSeenAt ?? 0)}</td>
                      <td>
                        {self ? (
                          <span className="text-[10px] text-muted-foreground">Signed in here</span>
                        ) : locked ? (
                          <span className="text-[10px] text-muted-foreground">Owner only</span>
                        ) : (
                          <button
                            type="button"
                            className="cad-ctl"
                            disabled={busy}
                            aria-label={`Revoke console access for ${account.name}`}
                            onClick={() => onChangeRole(account, 'engineer')}
                          >
                            {busy ? 'Revoking…' : 'Revoke access'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground">Role catalog</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Built-in roles, their console reach and the number of accounts holding each one.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ADMIN_ROLES.map((role) => {
            const count = accounts.filter((account) => account.role === role).length
            const roleGrants = grants(role)
            const consoleRole = isConsoleRole(role)
            return (
              <div key={role} className="rounded-lg border border-border/70 bg-card/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-semibold text-foreground">{ROLE_LABELS[role]}</h4>
                  <span className={`cad-chip ${consoleRole
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted text-muted-foreground'}`}>
                    {consoleRole ? 'Console' : 'Workbench'}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                <p className="mt-2 text-[11px] tabular-nums text-foreground">
                  {`${count} account${count === 1 ? '' : 's'}`}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {consoleRole ? `${roleGrants.length} console capabilities` : 'No console capabilities'}
                </p>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Capability matrix</h3>
            <p className="text-[11px] text-muted-foreground">
              A check means the role holds the capability. Owner-only rows are the boundary that stops an administrator from replacing the owner.
            </p>
          </div>
          {access?.source === 'built-in' && <span className="cad-chip">Built-in matrix</span>}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="admin-table min-w-[720px]">
            <caption className="sr-only">Capabilities granted to each built-in role</caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {ADMIN_ROLES.map((role) => <th key={role} scope="col" className="text-center">{ROLE_LABELS[role]}</th>)}
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_DEFINITIONS.map((definition) => (
                <tr key={definition.id}>
                  <td>
                    <p className="font-medium text-foreground">
                      {definition.label}
                      {definition.ownerOnly && <span className="ml-1.5 rounded-sm border border-warning/40 bg-warning/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning">owner only</span>}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{definition.description}</p>
                  </td>
                  {ADMIN_ROLES.map((role) => {
                    const granted = grants(role).includes(definition.id)
                    return (
                      <td key={role} className="text-center">
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-sm border ${granted
                          ? 'border-success/40 bg-success/10 text-success'
                          : 'border-border bg-muted/40 text-muted-foreground'}`}>
                          {granted ? <Check className="h-3 w-3" aria-hidden="true" /> : <Minus className="h-3 w-3" aria-hidden="true" />}
                        </span>
                        <span className="sr-only">{`${definition.label} ${granted ? 'granted' : 'not granted'} to ${ROLE_LABELS[role]}`}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">How authority is enforced</h3>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>The console signs in through its own storage key, so a workbench session cannot open it.</li>
            <li>Every read is behind row-level security; a refused client is refused by the database, not just by this screen.</li>
            <li>`guard_profile_changes()` checks `has_capability()` before a role or status changes, and reserves owner changes to owners.</li>
            <li>Self-demotion and self-suspension are refused in the console and in the trigger.</li>
            <li>Every accepted change appends to `admin_audit` in the same call; a failed append is reported, not hidden.</li>
          </ul>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Adding an operator</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Create the account in the identity service, then assign it the Administrator or Owner role here. Invitations
            are not shipped because they need the service-role admin API, and that key must never reach a browser.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            New sign-ups start with no role and no console access; they are governed by the viewer policy until an
            operator promotes them.
          </p>
        </Card>
      </div>
    </section>
  )
}
