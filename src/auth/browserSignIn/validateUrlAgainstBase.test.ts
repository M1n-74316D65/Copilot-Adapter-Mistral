import { describe, expect, it } from 'vitest';
import { validateUrlAgainstBase } from './validateUrlAgainstBase.js';
import { BrowserSignInError } from './browserSignInError.js';

const BASE = `https://console.mistral.ai/v1/signin`;

describe(`validateUrlAgainstBase`, () => {
    it(`accepts a URL on the same origin under the base path`, () => {
        expect(validateUrlAgainstBase(`https://console.mistral.ai/v1/signin/callback?code=abc`, BASE)).toBe(
            `https://console.mistral.ai/v1/signin/callback?code=abc`,
        );
    });

    it(`rejects a foreign host`, () => {
        expect(() => {
            return validateUrlAgainstBase(`https://evil.example.com/v1/signin/x`, BASE);
        }).toThrow(BrowserSignInError);
    });

    it(`rejects a different protocol`, () => {
        expect(() => {
            return validateUrlAgainstBase(`http://console.mistral.ai/v1/signin/x`, BASE);
        }).toThrow(BrowserSignInError);
    });

    it(`rejects a path outside the base path`, () => {
        expect(() => {
            return validateUrlAgainstBase(`https://console.mistral.ai/other/path`, BASE);
        }).toThrow(BrowserSignInError);
    });

    it(`rejects userinfo even when the host matches`, () => {
        expect(() => {
            return validateUrlAgainstBase(`https://attacker@console.mistral.ai/v1/signin/x`, BASE);
        }).toThrow(/credentials/);
        expect(() => {
            return validateUrlAgainstBase(`https://console.mistral.ai:443@evil.example.com/v1/signin/x`, BASE);
        }).toThrow(BrowserSignInError);
    });

    it(`rejects path-traversal via dot segments`, () => {
        expect(() => {
            return validateUrlAgainstBase(`https://console.mistral.ai/v1/../evil`, BASE);
        }).toThrow(BrowserSignInError);
    });

    it(`rejects path-traversal via percent-encoded dot segments`, () => {
        expect(() => {
            return validateUrlAgainstBase(`https://console.mistral.ai/v1/%2e%2e/evil`, BASE);
        }).toThrow(BrowserSignInError);
        expect(() => {
            return validateUrlAgainstBase(`https://console.mistral.ai/v1/signin/%2e%2e/%2e%2e/admin`, BASE);
        }).toThrow(BrowserSignInError);
    });

    it(`rejects a sibling path that only shares a string prefix`, () => {
        expect(() => {
            return validateUrlAgainstBase(`https://console.mistral.ai/v1/signin-extra/x`, BASE);
        }).toThrow(BrowserSignInError);
    });

    it(`rewrites the origin to the configured base when origin rewrite is allowed`, () => {
        const rewritten = validateUrlAgainstBase(`http://localhost:9999/v1/signin/x`, BASE, true);
        expect(rewritten).toBe(`https://console.mistral.ai/v1/signin/x`);
    });

    it(`still rejects a rewritten path outside the base path`, () => {
        expect(() => {
            return validateUrlAgainstBase(`http://localhost:9999/evil`, BASE, true);
        }).toThrow(BrowserSignInError);
    });

    it(`rejects non-URL input`, () => {
        expect(() => {
            return validateUrlAgainstBase(`not a url`, BASE);
        }).toThrow(BrowserSignInError);
    });
});
