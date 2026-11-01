/**
 * The shared code surface, tested through the contracts the panels already rely
 * on: an accessible name, a controlled string, and real keyboard events.
 *
 * jsdom's mocked ResizeObserver never fires, so the editor keeps its default
 * viewport and every line stays inside the rendered window. These tests assert
 * what the buffer and the backdrop say, never pixel geometry.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { CodeEditor } from '../components/editor/CodeEditor'
import type { LanguageId } from '../lib/editor/languages'

interface HarnessProps {
  value?: string
  language?: LanguageId
  readOnly?: boolean
  ariaLabel?: string
  lineNumbers?: boolean
}

/** The controlled-string shape a panel owns: the editor never edits in place. */
function harness(initial: string) {
  const calls: string[] = []
  function Harness({ value = initial, language = 'verilog', readOnly, ariaLabel = 'Source', lineNumbers }: HarnessProps) {
    const [text, setText] = useState(value)
    return (
      <CodeEditor
        value={text}
        language={language}
        ariaLabel={ariaLabel}
        readOnly={readOnly}
        lineNumbers={lineNumbers}
        onChange={next => {
          calls.push(next)
          setText(next)
        }}
      />
    )
  }
  return { Harness, calls }
}

const editor = (label = 'Source') => screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement

/** Place the caret the way a user would, then let the editor see it. */
function caretAt(node: HTMLTextAreaElement, start: number, end = start) {
  node.setSelectionRange(start, end)
  fireEvent.focus(node)
  fireEvent.click(node)
}

describe('CodeEditor', () => {
  it('keeps the textarea as the DOM contract the panels already drive', () => {
    const { Harness } = harness('assign a = b;')
    render(<Harness />)

    const node = editor()
    expect(node).toHaveValue('assign a = b;')

    fireEvent.change(node, { target: { value: 'assign a = c;' } })
    expect(node).toHaveValue('assign a = c;')
  })

  it('paints syntax colour in the backdrop, not in the textarea', () => {
    const { Harness } = harness('module m\n  wire a\nendmodule')
    const { container } = render(<Harness />)

    const keywords = Array.from(container.querySelectorAll('.text-syntax-keyword')).map(node => node.textContent)
    expect(keywords).toContain('module')
    expect(keywords).toContain('endmodule')
    expect(container.querySelector('.text-syntax-type')).toHaveTextContent('wire')
    // Both layers must share metrics or the colours drift away from the text.
    expect(container.querySelector('.code-input')).toHaveClass('code-metrics')
    expect(container.querySelector('.code-backdrop pre')).toHaveClass('code-metrics')
  })

  it('numbers the gutter from one and emphasises the caret line', () => {
    const { Harness } = harness('module m\n  wire a\nendmodule')
    const { container } = render(<Harness />)

    caretAt(editor(), 11)
    const gutter = container.querySelector('[data-code-gutter]')
    expect(gutter).not.toBeNull()
    expect(within(gutter as HTMLElement).getAllByText(/^\d+$/).map(node => node.textContent)).toEqual(['1', '2', '3'])
    expect(within(gutter as HTMLElement).getByText('2')).toHaveClass('font-semibold')
  })

  it('closes brackets, nests inside an empty pair and steps over the closer', () => {
    const { Harness } = harness('foo()')
    render(<Harness />)
    const node = editor()

    caretAt(node, 4)
    fireEvent.keyDown(node, { key: '(' })
    expect(node).toHaveValue('foo(())')
    expect(node.selectionStart).toBe(5)

    fireEvent.keyDown(node, { key: ')' })
    expect(node).toHaveValue('foo(())')
    expect(node.selectionStart).toBe(6)

    caretAt(node, 0, 5)
    fireEvent.keyDown(node, { key: '(' })
    expect(node).toHaveValue('(foo(()))')
    expect([node.selectionStart, node.selectionEnd]).toEqual([1, 6])
  })

  it('backspaces a whole empty pair, not just one side of it', () => {
    const { Harness, calls } = harness('foo()')
    render(<Harness />)
    const node = editor()

    caretAt(node, 4)
    fireEvent.keyDown(node, { key: 'Backspace' })
    expect(node).toHaveValue('foo')
    expect(calls[calls.length - 1]).toBe('foo')
  })

  it('indents a new line from what the previous one opens', () => {
    const { Harness } = harness('module m')
    render(<Harness />)
    const node = editor()

    caretAt(node, 8)
    fireEvent.keyDown(node, { key: 'Enter' })
    expect(node).toHaveValue('module m\n  ')
    expect(node.selectionStart).toBe(11)

    // A statement line keeps its own indentation instead of drifting right.
    fireEvent.change(node, { target: { value: '  wire a' } })
    const next = editor()
    caretAt(next, 8)
    fireEvent.keyDown(next, { key: 'Enter' })
    expect(next).toHaveValue('  wire a\n  ')
  })

  it('tabs a block in and shifts it back out', () => {
    const { Harness } = harness('a\nb')
    render(<Harness />)
    const node = editor()

    caretAt(node, 0, 3)
    fireEvent.keyDown(node, { key: 'Tab' })
    expect(node).toHaveValue('  a\n  b')

    caretAt(node, 0, 7)
    fireEvent.keyDown(node, { key: 'Tab', shiftKey: true })
    expect(node).toHaveValue('a\nb')
  })

  it('offers buffer-true completions with a ghost and accepts the active one', () => {
    const { Harness } = harness('wire counter\nwire countdown\nassign ')
    const { container } = render(<Harness />)
    const node = editor()

    fireEvent.change(node, { target: { value: 'wire counter\nwire countdown\nassign count' } })
    const listbox = screen.getByRole('listbox', { name: 'Source completions' })
    expect(within(listbox).getByText('Verilog words and names in this buffer')).toBeInTheDocument()
    const options = within(listbox).getAllByRole('option')
    expect(options.map(option => option.textContent?.replace('Tab', ''))).toEqual(['counter', 'countdown', '$countones'])
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(container.querySelector('.code-ghost')?.textContent).toBe('er')
    expect(node).toHaveAttribute('aria-expanded', 'true')
    expect(node).toHaveAttribute('aria-controls', listbox.id)
    expect(node).toHaveAttribute('aria-activedescendant', `${listbox.id}-option-0`)

    fireEvent.keyDown(node, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('countdown')
    expect(container.querySelector('.code-ghost')?.textContent).toBe('down')

    fireEvent.keyDown(node, { key: 'Tab' })
    expect(node).toHaveValue('wire counter\nwire countdown\nassign countdown')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes the popup on Escape so Tab is still indentation afterwards', () => {
    const { Harness } = harness('wire counter\nassign ')
    render(<Harness />)
    const node = editor()

    fireEvent.change(node, { target: { value: 'wire counter\nassign co' } })
    fireEvent.keyDown(node, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    // Nothing selected and no popup: Tab must indent at the caret, not accept.
    fireEvent.keyDown(node, { key: 'Tab' })
    expect(node).toHaveValue('wire counter\nassign co  ')
  })

  it('marks every match, walks them and replaces them', () => {
    const { Harness } = harness('R1 a 0 1k\nR2 b 0 1k\nR3 c 0 2k')
    render(<Harness language="spice" ariaLabel="Netlist" />)
    const node = editor('Netlist')

    fireEvent.keyDown(node, { key: 'f', ctrlKey: true })
    const find = screen.getByRole('searchbox', { name: 'Find' })
    fireEvent.change(find, { target: { value: '1k' } })
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(find.closest('label')).toHaveTextContent('1/2')

    fireEvent.keyDown(node, { key: 'ArrowDown' })
    expect([node.selectionStart, node.selectionEnd]).toEqual([17, 19])
    expect(screen.getByText('2 of 2')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Replace with' }), { target: { value: '4k7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(node).toHaveValue('R1 a 0 4k7\nR2 b 0 4k7\nR3 c 0 2k')

    fireEvent.keyDown(node, { key: 'Escape' })
    expect(screen.queryByRole('searchbox', { name: 'Find' })).toBeNull()
  })

  it('toggles the comment marker the language actually uses', () => {
    const { Harness } = harness('wire a = 1')
    render(<Harness />)
    const node = editor()

    caretAt(node, 3)
    fireEvent.keyDown(node, { key: '/', ctrlKey: true })
    expect(node).toHaveValue('// wire a = 1')

    fireEvent.keyDown(node, { key: '/', ctrlKey: true })
    expect(node).toHaveValue('wire a = 1')
  })

  it('sends Home to the first character before the browser takes it to column one', () => {
    const { Harness } = harness('    wire a')
    render(<Harness />)
    const node = editor()

    caretAt(node, 10)
    fireEvent.keyDown(node, { key: 'Home' })
    expect([node.selectionStart, node.selectionEnd]).toEqual([4, 4])

    // Already at the first character, so the editor stands down; jsdom has no
    // native Home to move it further, which is exactly the "not intercepted" case.
    fireEvent.keyDown(node, { key: 'Home' })
    expect([node.selectionStart, node.selectionEnd]).toEqual([4, 4])
  })

  it('reports the caret position, selection and language in the status strip', () => {
    const { Harness } = harness('module m\n  wire a')
    render(<Harness />)
    const node = editor()

    caretAt(node, 11)
    expect(screen.getByText('Ln 2, Col 3')).toBeInTheDocument()
    expect(screen.getByText('2 lines')).toBeInTheDocument()
    expect(screen.getByText('Verilog')).toBeInTheDocument()

    caretAt(node, 7, 11)
    expect(screen.getByText('4 selected')).toBeInTheDocument()
  })

  it('lets a read-only buffer be read and selected but not edited', () => {
    const { Harness, calls } = harness('V1 1 0 5')
    render(<Harness readOnly ariaLabel="Deck" />)
    const node = editor('Deck')

    expect(node).toHaveAttribute('readonly')
    caretAt(node, 3)
    fireEvent.keyDown(node, { key: '(' })
    fireEvent.keyDown(node, { key: '/', ctrlKey: true })
    fireEvent.keyDown(node, { key: 'Tab' })
    expect(calls).toEqual([])
    expect(node).toHaveValue('V1 1 0 5')
  })

  // Both of these were found in the browser, not in jsdom: a utility class the
  // test could see but the cascade could not win, and a padding pair that
  // added up to eight pixels of drift between the two layers.
  it('leaves the textarea with no text utility so the backdrop keeps the colour', () => {
    const { Harness } = harness('module m')
    render(<Harness />)
    const classes = editor().className.split(/\s+/)

    expect(classes).toContain('code-input')
    expect(classes.filter(token => token.startsWith('text-'))).toEqual([])
  })

  it('puts the caret and the highlighted text at the same horizontal origin', () => {
    for (const lineNumbers of [true, false]) {
      const { Harness } = harness('module m')
      const { unmount } = render(<Harness lineNumbers={lineNumbers} />)
      const frame = document.querySelector('.code-frame') as HTMLElement
      const backdrop = frame.querySelector('.code-backdrop') as HTMLElement
      const firstLine = backdrop.querySelector('pre > div') as HTMLElement

      const textOrigin = Number.parseInt(editor().style.paddingLeft, 10)
      const paintOrigin = Number.parseInt(backdrop.style.left, 10) + Number.parseInt(firstLine.style.paddingLeft, 10)
      expect(paintOrigin).toBe(textOrigin)
      unmount()
    }
  })
})
