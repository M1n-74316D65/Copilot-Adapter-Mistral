import { Mistral } from '@mistralai/mistralai';
import { workspace } from 'vscode';
import type { MistralClientLogger } from './clientLogger.js';

export function createMistralClient ( apiKey: string, log: MistralClientLogger ): Mistral {
    const config = workspace.getConfiguration( `mistral` );
    const baseUrl = config.get<string>( `baseUrl` );
    const options: ConstructorParameters<typeof Mistral>[ 0 ] = {
        apiKey,
        // Total request timeout, matching vibe's default api_timeout (720s).
        timeoutMs: 720_000,
        retryConfig: {
            strategy: `backoff`,
            backoff: { initialInterval: 1000, maxInterval: 60000, exponent: 2, maxElapsedTime: 300000 },
            retryConnectionErrors: true,
        },
    };
    if ( baseUrl ) {
        options.serverURL = validateBaseUrl( baseUrl );
        log.info( `[Mistral] Using custom base URL: ` + baseUrl );
    }
    return new Mistral( options );
}

const LOOPBACK_HOSTS = new Set( [ `localhost`, `127.0.0.1`, `::1`, `[::1]` ] );

/**
 * Guards the user-configured base URL before the API key is sent to it as a
 * bearer token. HTTPS is required unless the host is loopback (self-hosted
 * dev servers), so a typo or synced setting cannot leak the key to a plain
 * HTTP or attacker-controlled endpoint.
 */
export function validateBaseUrl ( baseUrl: string ): string {
    let url: URL;
    try {
        url = new URL( baseUrl );
    } catch {
        throw new Error( `Mistral base URL is not a valid URL: ${ baseUrl }` );
    }
    if ( url.username || url.password ) {
        throw new Error( `Mistral base URL must not contain credentials.` );
    }
    const isLoopback = LOOPBACK_HOSTS.has( url.hostname.toLowerCase() );
    if ( url.protocol === `https:` ) {
        return baseUrl;
    }
    if ( url.protocol === `http:` && isLoopback ) {
        return baseUrl;
    }
    throw new Error( `Mistral base URL must use https (http is only allowed for localhost).` );
}
