/**
 * The marketing FAQ, read from the deployment.
 *
 * This is a server component: the rows arrive with the document, so the FAQ is
 * complete without JavaScript. `details` gives the accordion behaviour natively.
 * When no rows are published the section says so; there is no baked substitute.
 */
import { loadPublicFaq, type FaqSurface } from '../../src/lib/content/faq'

export default async function FaqList({ surface = 'home' }: { surface?: FaqSurface }) {
  const rows = await loadPublicFaq(surface)

  if (rows.length === 0) {
    return (
      <p className="body" data-source="unconfigured">
        The FAQ has not been published yet. An operator can add questions from the admin console.
      </p>
    )
  }

  return (
    <div className="faq" id={surface === 'home' ? 'faq-list' : 'pricing-faq-list'} data-source="deployment">
      {rows.map((row, index) => (
        <details className="faq-item" key={`${index}-${row.question}`} open={index === 0}>
          <summary>{row.question}</summary>
          <p>{row.answer}</p>
        </details>
      ))}
    </div>
  )
}
