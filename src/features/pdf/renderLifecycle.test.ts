import { describe, expect, it } from 'vitest'
import { waitForRenderCompletion } from './renderLifecycle'

describe('PDF canvas render lifecycle', () => {
  it('does not allow the next render to reuse a canvas until the prior render promise settles', async () => {
    let finishPrevious!: () => void
    let previousFinished = false
    const previousTask = {
      promise: new Promise<void>((resolve) => {
        finishPrevious = () => {
          previousFinished = true
          resolve()
        }
      }),
    }
    const waitingForCanvas = waitForRenderCompletion(previousTask)
    await Promise.resolve()
    expect(previousFinished).toBe(false)
    finishPrevious()
    await waitingForCanvas
    expect(previousFinished).toBe(true)
  })

  it('treats a cancelled render rejection as a settled canvas task', async () => {
    await expect(waitForRenderCompletion({ promise: Promise.reject(new Error('RenderingCancelledException')) }))
      .resolves.toBeUndefined()
  })
})
