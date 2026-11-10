/**
 * The header presence roster.
 *
 * These tests pin what the group actually promises: only active people are
 * drawn, the count in the accessible name matches the avatars on screen, and a
 * person without a photo is still identifiable by the letter they use.
 */
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import UserPresence from '../components/collaboration/UserPresence'

const person = (overrides: Partial<Parameters<typeof UserPresence>[0]['users'][number]> = {}) => ({
  id: 'u1',
  name: 'Dana Ruiz',
  email: 'dana@example.com',
  color: '#3b82f6',
  isActive: true,
  lastSeen: Date.now(),
  ...overrides,
})

describe('UserPresence', () => {
  it('draws nothing when nobody else is active', () => {
    const { container } = render(
      <UserPresence users={[person({ isActive: false }), person({ id: 'u2', isActive: false })]} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('draws one avatar per active person and counts them in the group name', () => {
    render(<UserPresence users={[person(), person({ id: 'u2', name: 'Amir Khan' })]} />)

    const group = screen.getByRole('group', { name: '2 other collaborators in this project' })
    expect(within(group).getByText('D')).toBeInTheDocument()
    expect(within(group).getByText('A')).toBeInTheDocument()
  })

  it('says which collaborator an avatar is, and when they were last seen', () => {
    render(<UserPresence users={[person({ lastSeen: Date.now() - 30_000 })]} />)

    expect(screen.getByRole('group', { name: '1 other collaborator in this project' })).toBeInTheDocument()
    expect(screen.getByTitle('Dana Ruiz (dana@example.com) — active 30s ago')).toBeInTheDocument()
  })

  it('prefers the photo to the letter when the provider supplies one', () => {
    render(<UserPresence users={[person({ avatar: 'https://example.com/dana.png' })]} />)

    expect(screen.getByRole('img', { name: 'Dana Ruiz' })).toHaveAttribute(
      'src',
      'https://example.com/dana.png',
    )
  })
})
