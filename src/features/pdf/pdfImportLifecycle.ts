/** Keeps results from an earlier async PDF open from replacing the newest import. */
export function isCurrentPdfImport(requestedOperation: number, activeOperation: number): boolean {
  return Number.isSafeInteger(requestedOperation)
    && Number.isSafeInteger(activeOperation)
    && requestedOperation > 0
    && requestedOperation === activeOperation
}
