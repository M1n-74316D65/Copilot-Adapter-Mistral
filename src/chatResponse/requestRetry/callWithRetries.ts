import { readProviderFailure } from './providerFailure.js';

/**
 * Retry loop ported from mistral-vibe's `adapters/_retry.py`.
 *
 * One attempt covers opening the stream AND reading it to the end; a failure
 * part way through is as retryable as one before it starts. The elapsed
 * budget bounds when a new attempt may start, not how long one may run. A
 * detected stall gets one exempt retry (a non-streaming long generation would
 * otherwise be paid for on every attempt).
 */

export const MAX_ELAPSED_MS = 300_000;
export const MAX_RETRY_DELAY_MS = 30_000;
export const MAX_RETRY_JITTER_MS = 1_000;
export const MAX_STALL_RETRIES = 1;

export interface RetryLogger {
    warn: ( message: string ) => void;
}

export interface RetryOptions {
    signal?: AbortSignal;
    log: RetryLogger;
    maxElapsedMs?: number;
    now?: () => number;
    sleep?: ( ms: number ) => Promise<void>;
    random?: () => number;
}

export async function callWithRetries<T> (
    attempt: () => Promise<T>,
    options: RetryOptions,
): Promise<T> {
    const now = options.now ?? ( () => {
        return Date.now();
    } );
    const sleep = options.sleep ?? ( ( ms: number ) => {
        return new Promise<void>( resolve => {
            return setTimeout( resolve, ms );
        } );
    } );
    const random = options.random ?? Math.random;
    const maxElapsedMs = options.maxElapsedMs ?? MAX_ELAPSED_MS;
    const started = now();
    let retryAttempt = 0;
    let stallRetries = 0;
    while ( true ) {
        try {
            return await attempt();
        } catch ( error ) {
            if ( options.signal?.aborted ) {
                throw error;
            }
            const failure = readProviderFailure( error, options.signal );
            const stallSpent = failure.stalled && stallRetries >= MAX_STALL_RETRIES;
            if ( !failure.retryable || stallSpent ) {
                throw error;
            }
            const jitter = random() * MAX_RETRY_JITTER_MS;
            const backoff = Math.min( 1000 * 2 ** retryAttempt, MAX_RETRY_DELAY_MS );
            const waitMs = failure.retryAfterMs !== undefined
                ? failure.retryAfterMs + jitter
                : backoff + jitter;
            const budgetSpent = now() - started + waitMs > maxElapsedMs;
            const stallExempt = failure.stalled && maxElapsedMs > 0;
            if ( budgetSpent && !stallExempt ) {
                throw error;
            }
            const delayMs = Math.min( waitMs, MAX_RETRY_DELAY_MS );
            options.log.warn(
                `[Mistral] Retrying completion (attempt ${ retryAttempt + 2 }, delay ${ ( delayMs / 1000 ).toFixed( 1 ) }s): ` +
                ( error instanceof Error ? error.name : typeof error ),
            );
            await sleep( delayMs );
            if ( failure.stalled ) {
                stallRetries += 1;
            }
            retryAttempt += 1;
        }
    }
}
