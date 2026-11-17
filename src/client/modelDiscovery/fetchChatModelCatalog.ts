import type { Mistral } from '@mistralai/mistralai';
import type { MistralModel } from '../../types.js';
import type { MistralClientLogger } from '../clientLogger.js';
import { CapabilityModelStore } from '../modelStore.js';
import { CreateAuthoredModelCards } from './createAuthoredModelCards.js';
import type { KnownModelCard } from './knownModelCard.js';
import { ModelCardConverter } from './modelCardConverter.js';
import { fetchModelCatalog, type CatalogCacheStore } from './fetchModelCatalog.js';

export async function FetchChatModelCatalog (
    client: Mistral,
    log: MistralClientLogger,
    cache?: CatalogCacheStore,
): Promise<MistralModel[]> {
    // Prefer the official /model-catalog (vibe-code surface) with cache
    // fail-open; fall back to GET /v1/models when the catalog is unavailable.
    const catalogCards = await fetchModelCatalog( log, cache );
    let apiCards: KnownModelCard[] | undefined = catalogCards;
    if ( !apiCards ) {
        const response = await client.models.list();
        if ( !response.data ) {
            log.error( `[Mistral] Failed to fetch models. Check API key and network connectivity.` );
            return [];
        }
        apiCards = [];
        for ( const card of response.data ) {
            if ( !card || ( card.type !== `base` && card.type !== `fine-tuned` ) ) {
                continue;
            }
            if ( typeof card.id !== `string` || !card.id.trim() ) {
                continue;
            }
            if ( !apiCards.some( existing => {
                return existing.id === card.id;
            } ) ) {
                apiCards.push( card );
            }
        }
    }
    const byId = new Map<string, KnownModelCard>();
    for ( const card of CreateAuthoredModelCards() ) {
        byId.set( card.id, card );
    }
    const apiIdentifiers = new Set<string>();
    for ( const card of apiCards ) {
        if ( !apiIdentifiers.has( card.id ) ) {
            byId.set( card.id, card );
            apiIdentifiers.add( card.id );
        }
    }
    for ( const [ identifier ] of byId ) {
        if ( apiIdentifiers.has( identifier ) ) {
            continue;
        }
        const declaredByApi = [ ...byId.values() ].some( candidate => {
            return apiIdentifiers.has( candidate.id ) && candidate.aliases?.includes( identifier );
        } );
        if ( declaredByApi ) {
            byId.delete( identifier );
        }
    }
    const convertedModels: MistralModel[] = [];
    const converter = new ModelCardConverter();
    for ( const card of byId.values() ) {
        try {
            convertedModels.push( {
                ...converter.Convert( card ),
                catalogSource: apiIdentifiers.has( card.id ) ? `api` : `provisioned`,
            } );
        } catch ( error ) {
            log.warn( `[Mistral] Skipping invalid model "${ card.id }": ${ String( error ) }` );
        }
    }
    const store = CapabilityModelStore.getInstance();
    store.clear();
    for ( const model of convertedModels ) {
        store.insertModel( model );
    }
    return store.getChatModels();
}
