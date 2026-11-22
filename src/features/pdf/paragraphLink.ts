export function shouldActivateParagraphLink({
  isTrustedClick,
  hasTextSelection,
  isInteractiveTarget,
}: {
  isTrustedClick: boolean
  hasTextSelection: boolean
  isInteractiveTarget: boolean
}) {
  return isTrustedClick && !hasTextSelection && !isInteractiveTarget
}

export function findParagraphLinkTarget<T extends { dataset: DOMStringMap }>(elements: Iterable<T>, paragraphId: string): T | null {
  for (const element of elements) if (element.dataset.paragraphId === paragraphId) return element
  return null
}
