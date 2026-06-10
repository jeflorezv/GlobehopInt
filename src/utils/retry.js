/**
 * Wraps an async function with exponential-backoff retry logic.
 *
 * Retries on: 429 (rate limit) and 5xx (server errors).
 * Rethrows immediately on: other 4xx — those are caller errors a retry won't fix.
 *
 * Callers are responsible for throwing an error with a `status` property when
 * an HTTP response is not OK, e.g.:
 *   if (!resp.ok) { const e = new Error(...); e.status = resp.status; throw e; }
 *
 * @param {() => Promise<any>} fn         Async operation to attempt.
 * @param {{ retries?: number, delay?: number, multiplier?: number }} [opts]
 * @returns {Promise<any>}
 */
export async function withRetry(fn, { retries = 3, delay = 1000, multiplier = 2 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const status = err.status ?? err.statusCode ?? err.response?.status;
      if (status >= 400 && status < 500 && status !== 429) throw err;

      if (attempt < retries) {
        await sleep(delay * multiplier ** attempt);
      }
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
