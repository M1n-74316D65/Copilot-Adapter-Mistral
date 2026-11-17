/**
 * Stream watchdog ported from mistral-vibe's `completion_profile/stream_guard.py`.
 *
 * The first stream event must arrive within FIRST_OUTPUT_WAIT_MS; after that,
 * STREAM_IDLE_MS without any event is a stall. A stall surfaces as
 * StreamStalledError so the retry layer can give it one exempt retry.
 */

export const FIRST_OUTPUT_WAIT_MS = 720_000;
export const STREAM_IDLE_MS = 300_000;

export class StreamStalledError extends Error {
    public override readonly name = `StreamStalledError`;
    public constructor ( message: string ) {
        super( message );
    }
}

export interface StreamGuardLogger {
    debug: ( message: string ) => void;
    warn: ( message: string ) => void;
}

/**
 * Wraps a completion event stream with the first-output / idle watchdog.
 * Cancellation via `signal` aborts iteration with an AbortError, which the
 * retry layer treats as non-retryable.
 */
export interface StreamGuardLimits {
    firstOutputMs?: number;
    idleMs?: number;
}

export async function* guardStream<T> (
    events: AsyncIterable<T>,
    signal: AbortSignal | undefined,
    log: StreamGuardLogger,
    limits: StreamGuardLimits = {},
): AsyncGenerator<T> {
    const firstOutputMs = limits.firstOutputMs ?? FIRST_OUTPUT_WAIT_MS;
    const idleMs = limits.idleMs ?? STREAM_IDLE_MS;
    const iterator = events[ Symbol.asyncIterator ]();
    let receivedFirst = false;
    try {
        while ( true ) {
            if ( signal?.aborted ) {
                const abort = new Error( `Stream reading aborted.` );
                abort.name = `AbortError`;
                throw abort;
            }
            const limit = receivedFirst ? idleMs : firstOutputMs;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>( ( _resolve, reject ) => {
                timer = setTimeout( () => {
                    reject( new StreamStalledError(
                        receivedFirst
                            ? `Stream stalled: no event for ${ idleMs / 1000 }s after first output.`
                            : `Stream stalled: no first event within ${ firstOutputMs / 1000 }s.`,
                    ) );
                }, limit );
            } );
            let next: IteratorResult<T>;
            try {
                next = await Promise.race( [ iterator.next(), timeout ] );
            } catch ( error ) {
                if ( error instanceof StreamStalledError ) {
                    log.warn( `[Mistral] ${ error.message }` );
                }
                throw error;
            } finally {
                if ( timer !== undefined ) {
                    clearTimeout( timer );
                }
            }
            if ( next.done ) {
                return;
            }
            receivedFirst = true;
            yield next.value;
        }
    } finally {
        await iterator.return?.( undefined );
    }
}
