import { window } from 'vscode';
import { AuthDeps } from './authDeps.js';
import { storeAndActivate } from './storeAndActivate.js';
import { createMistralClient } from '../client/index.js';
import { GetUserFriendlyError } from '../extensionLifecycle/getUserFriendlyError.js';

/** Manual API-key entry fallback. */
export async function enterApiKeyManually ( deps: AuthDeps ): Promise<string | undefined> {
    const { context, log } = deps;
    const existing = await context.secrets.get( `MISTRAL_API_KEY` );
    log.debug( `[Mistral] Prompting user for API key (existing present: ` + !!existing + `)` );
    const apiKey = await window.showInputBox( {
        placeHolder: existing ? `Leave empty to keep the stored key, or enter a new one` : `Mistral API Key`,
        password: true,
        prompt: `Enter your Mistral API key (get one at https://console.mistral.ai)`,
        ignoreFocusOut: true,
        validateInput: value => {
            if ( !value && existing ) {
                return undefined;
            }
            if ( !value || value.trim().length === 0 ) {
                return `API key is required`;
            }
            if ( value.length < 20 ) {
                return `API key appears too short`;
            }
            return undefined;
        },
    } );

    if ( apiKey !== undefined && apiKey.trim().length === 0 && existing ) {
        return existing;
    }

    const trimmedApiKey = apiKey?.trim();
    if ( !trimmedApiKey ) {
        log.info( `[Mistral] enterApiKeyManually canceled by user` );
        return undefined;
    }

    const testClient = createMistralClient( trimmedApiKey, deps.log );
    try {
        await testClient.models.list();
        return await storeAndActivate( deps, trimmedApiKey );
    } catch ( error ) {
        const friendly = GetUserFriendlyError( error );
        log.error( `[Mistral] API key save failed: ${ friendly }` );
        await window.showErrorMessage( `API key validation failed: ${ friendly }` );
        return undefined;
    }
}
