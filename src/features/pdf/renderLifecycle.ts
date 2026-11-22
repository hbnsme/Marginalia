/** Wait until PDF.js has released a canvas before a newer render reuses it. */
export async function waitForRenderCompletion(task: { promise: Promise<unknown> } | null): Promise<void> {
  if (!task) return
  try {
    await task.promise
  } catch {
    // Cancellation rejects the render promise; its completion still releases the canvas.
  }
}
