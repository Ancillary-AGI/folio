import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import FolioLogo, { FolioMark, FolioWordmark } from '../components/brand/FolioLogo'

describe('Folio brand', () => {
  it('exposes the mark as a labelled image when a title is given', () => {
    render(<FolioMark title="Folio" />)
    const mark = screen.getByRole('img', { name: 'Folio' })
    expect(mark.tagName.toLowerCase()).toBe('svg')
  })

  it('hides the bare mark and wordmark from assistive tech', () => {
    const { container } = render(
      <div>
        <FolioMark />
        <FolioWordmark />
      </div>,
    )
    expect(screen.queryByRole('img')).toBeNull()
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(2)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })

  it('renders the lockup as a single named image', () => {
    render(<FolioLogo showTagline />)
    expect(screen.getByRole('img', { name: 'Folio' })).toBeInTheDocument()
    expect(screen.getByText('Engineering workbench')).toBeInTheDocument()
  })
})
