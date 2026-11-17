import { BrowserSignInError } from './browserSignInError.js';

/**
 * Validate a server-returned URL against the expected base: same origin and the
 * path must live under the base path. Mirrors vibe's origin/path check so a
 * compromised or spoofed response can't redirect the browser or our polling to
 * an attacker-controlled host.
 */
export function validateUrlAgainstBase ( value: string, baseUrl: string, allowOriginRewrite = false ): string {
    let current: URL;
    let base: URL;
    try {
        current = new URL( value );
        base = new URL( baseUrl );
    } catch {
        throw new BrowserSignInError( `Sign-in returned an invalid URL.`, `invalid_url` );
    }
    let effective = current;
    if ( current.protocol !== base.protocol || current.host !== base.host ) {
        // Ported from mistral-vibe's allow_origin_rewrite: for self-hosted or
        // proxied setups the caller may opt in to rewriting the returned
        // origin to the configured base instead of rejecting it.
        if ( !allowOriginRewrite ) {
            throw new BrowserSignInError( `Sign-in returned a URL with an unexpected host.`, `invalid_url` );
        }
        effective = new URL( value );
        effective.protocol = base.protocol;
        effective.host = base.host;
        effective.port = base.port;
    }
    if ( effective.username || effective.password ) {
        throw new BrowserSignInError( `Sign-in returned a URL with embedded credentials.`, `invalid_url` );
    }
    const normBase = normalizeUrlPath( base.pathname ).replace( /\/+$/, `` );
    const normCurrent = normalizeUrlPath( effective.pathname );
    if ( normBase && normCurrent !== normBase && !normCurrent.startsWith( `${ normBase }/` ) ) {
        throw new BrowserSignInError( `Sign-in returned a URL with an unexpected path.`, `invalid_url` );
    }
    return effective === current ? value : effective.toString();
}

/**
 * Percent-decodes and resolves `.` / `..` segments, mirroring vibe's
 * `unquote` + `posixpath.normpath`, so encoded or dot-segment path tricks
 * (`%2e%2e`, `/a/../b`) cannot pass the prefix check.
 */
function normalizeUrlPath ( path: string ): string {
    let decoded: string;
    try {
        decoded = decodeURIComponent( path );
    } catch {
        decoded = path;
    }
    const segments: string[] = [];
    for ( const segment of decoded.split( `/` ) ) {
        if ( segment === `` || segment === `.` ) {
            continue;
        }
        if ( segment === `..` ) {
            segments.pop();
            continue;
        }
        segments.push( segment );
    }
    return `/${ segments.join( `/` ) }`;
}
