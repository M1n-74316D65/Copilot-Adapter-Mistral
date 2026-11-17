import { describe, expect, it, vi } from 'vitest';
import { workspace } from '../test/vscode.mock.js';

const { validateBaseUrl, createMistralClient } = await import(`./createMistralClient.js`);

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };

function setBaseUrl (value: string | undefined): void {
    vi.mocked(workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(value),
        update: vi.fn(),
    } as never);
}

describe(`validateBaseUrl`, () => {
    it(`accepts https URLs`, () => {
        expect(validateBaseUrl(`https://api.mistral.ai/v1`)).toBe(`https://api.mistral.ai/v1`);
        expect(validateBaseUrl(`https://my-azure.azure-api.net/mistral`)).toContain(`azure`);
    });

    it(`allows http only for loopback hosts`, () => {
        expect(validateBaseUrl(`http://localhost:8080/v1`)).toContain(`localhost`);
        expect(validateBaseUrl(`http://127.0.0.1:8080`)).toContain(`127.0.0.1`);
        expect(() => {
            return validateBaseUrl(`http://192.168.1.10:8080/v1`);
        }).toThrow(/https/);
        expect(() => {
            return validateBaseUrl(`http://api.mistral.ai/v1`);
        }).toThrow(/https/);
    });

    it(`rejects URLs with embedded credentials`, () => {
        expect(() => {
            return validateBaseUrl(`https://user:pass@api.mistral.ai/v1`);
        }).toThrow(/credentials/);
    });

    it(`rejects invalid URLs`, () => {
        expect(() => {
            return validateBaseUrl(`not a url`);
        }).toThrow(/valid URL/);
    });
});

describe(`createMistralClient`, () => {
    it(`uses the default server when no baseUrl is configured`, () => {
        setBaseUrl(undefined);
        const client = createMistralClient(`test-key-1234567890`, log as never);
        expect(client).toBeTruthy();
    });

    it(`throws for an insecure non-loopback baseUrl instead of sending the key there`, () => {
        setBaseUrl(`http://evil.example.com/v1`);
        expect(() => {
            return createMistralClient(`test-key-1234567890`, log as never);
        }).toThrow(/https/);
    });

    it(`accepts an https baseUrl`, () => {
        setBaseUrl(`https://proxy.internal.example.com/mistral`);
        expect(() => {
            return createMistralClient(`test-key-1234567890`, log as never);
        }).not.toThrow();
    });
});
