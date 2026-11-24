import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import VisualProgrammingEditor from '../components/visual-programming/VisualProgrammingEditor'
import { useAppStore } from '../stores/useAppStore'

describe('VisualProgrammingEditor demo', () => {
  beforeEach(() => {
    useAppStore.setState({ demoRequest: null })
  })

  it('loads the behaviour graph and builds it when the gallery requests it', async () => {
    useAppStore.setState({ demoRequest: 'visual-blocks' })

    render(<VisualProgrammingEditor onClose={() => {}} />)

    expect(await screen.findByText(/Build OK/)).toBeInTheDocument()
    expect(screen.getByText(/Blocks: 5/)).toBeInTheDocument()
    expect(screen.getByText(/Connections: 2/)).toBeInTheDocument()
    // Edges can only attach when the custom nodes expose handles.
    expect(document.querySelectorAll('.react-flow__handle')).toHaveLength(6)
    await waitFor(() => expect(useAppStore.getState().demoRequest).toBeNull())
  })
})
