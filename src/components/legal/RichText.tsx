/**
 * The public renderer for operator-authored rich text.
 *
 * Every element here is built from the structured document model; no stored
 * string is ever handed to `dangerouslySetInnerHTML`. Links have already been
 * restricted to http(s) and mailto by `normalizeRichText` and are checked
 * again by construction (the model only carries a href the parser kept).
 */
import { Fragment, type ReactNode } from 'react'
import type { RichTextBlock, RichTextRun } from '../../lib/legal/richText'

function Run({ run }: { run: RichTextRun }) {
  let content: ReactNode = run.text.split('\n').map((line, index, all) => (
    <Fragment key={index}>
      {line}
      {index < all.length - 1 && <br />}
    </Fragment>
  ))
  if (run.code) content = <code>{content}</code>
  if (run.bold) content = <strong>{content}</strong>
  if (run.italic) content = <em>{content}</em>
  if (run.underline) content = <u>{content}</u>
  if (run.strike) content = <s>{content}</s>
  if (run.href) {
    content = <a href={run.href} rel="noopener noreferrer">{content}</a>
  }
  return <>{content}</>
}

function Runs({ runs }: { runs: readonly RichTextRun[] }) {
  return <>{runs.map((run, index) => <Run key={index} run={run} />)}</>
}

export default function RichText({ blocks }: { blocks: readonly RichTextBlock[] }) {
  if (blocks.length === 0) return null
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'paragraph') {
          return <p className="body" key={index}><Runs runs={block.runs} /></p>
        }
        if (block.type === 'heading') {
          const Heading = block.level === 3 ? 'h3' : 'h2'
          return <Heading key={index}><Runs runs={block.runs} /></Heading>
        }
        if (block.type === 'quote') {
          return (
            <blockquote className="body rich-quote" key={index}>
              <Runs runs={block.runs} />
            </blockquote>
          )
        }
        const List = block.ordered ? 'ol' : 'ul'
        return (
          <List className="body rich-list" key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}><Runs runs={item} /></li>
            ))}
          </List>
        )
      })}
    </>
  )
}
