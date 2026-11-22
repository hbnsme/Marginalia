import type { ReactNode } from 'react'
import type { PdfParagraph } from './pdfTypes'
import { activateParagraphLocation } from './paragraphLocation'

export function ParagraphLocationButton({
  paragraph,
  label,
  className,
  onLocate,
  onActivate,
  children,
}: {
  paragraph: PdfParagraph
  label: string
  className: string
  onLocate: (paragraph: PdfParagraph) => void
  onActivate?: (paragraph: PdfParagraph) => void
  children: ReactNode
}) {
  return <button
    type="button"
    className={className}
    aria-label={label}
    data-paragraph-id={paragraph.id}
    onClick={(event) => {
      // Do not turn a text selection made for copying into an unexpected scroll.
      activateParagraphLocation(paragraph, event.detail > 0 ? window.getSelection()?.toString() : '', (value) => {
        onLocate(value)
        onActivate?.(value)
      })
    }}
  >{children}</button>
}
