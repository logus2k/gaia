class CountryDataManager {
    constructor() {
        this.countryData = null;
        this.loaded = false;
        this.loadingPromise = null;
        this.worker = null;
        this.workerCallbacks = new Map();
        this.messageId = 0;
        this.wikidataCache = new Map();
    }

    // Initialize the worker by loading external script
    initWorker() {
        if (this.worker) return;

        // Load worker from external file
        this.worker = new Worker('./script/country.data.worker.js');
        
        this.worker.onmessage = (e) => {
            const { id, success, data, error } = e.data;
            const callback = this.workerCallbacks.get(id);
            
            if (callback) {
                if (success) {
                    callback.resolve(data);
                } else {
                    callback.reject(new Error(error));
                }
                this.workerCallbacks.delete(id);
            }
        };

        this.worker.onerror = (error) => {
            console.error('Worker error:', error);
        };
    }

    sendMessageToWorker(action, data = {}) {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                this.initWorker();
            }
            
            const id = ++this.messageId;
            this.workerCallbacks.set(id, { resolve, reject });
            
            this.worker.postMessage({ id, action, data });
        });
    }

    async loadData(url = 'http://localhost:6678/data/countries-basic.json') {
        if (this.loadingPromise) {
            return this.loadingPromise;
        }
        
        this.loadingPromise = this.sendMessageToWorker('LOAD_DATA', { url });
        
        try {
            const result = await this.loadingPromise;
            this.loaded = result.loaded;
            return result;
        } catch (error) {
            this.loadingPromise = null;
            throw error;
        }
    }

    async searchByName(searchTerm) {
        return this.sendMessageToWorker('SEARCH_BY_NAME', { term: searchTerm });
    }

    async getByName(exactName) {
        return this.sendMessageToWorker('GET_BY_NAME', { name: exactName });
    }

    async getAllCountries() {
        return this.sendMessageToWorker('GET_ALL_COUNTRIES');
    }

    // Fetch detailed information from Wikidata (main thread to avoid CORS)
    async fetchWikidataInfo(wikidataId) {
        if (!wikidataId) {
            throw new Error('No Wikidata ID provided');
        }

        console.log('Fetching Wikidata info for:', wikidataId);

        // Check cache first
        if (this.wikidataCache.has(wikidataId)) {
            console.log('Using cached data for:', wikidataId);
            return this.wikidataCache.get(wikidataId);
        }

        try {
            // Make API call from main thread to avoid CORS issues
            const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json`;
            
            console.log('Making request to Wikidata API for:', wikidataId);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'CountryDataManager/1.0'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`Wikidata request failed: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Wikidata response received for:', wikidataId);
            
            // Process result
            let result = {
                wikidataId: wikidataId,
                country: null,
                capital: null,
                currency: null,
                language: null,
                description: null
            };

            if (data.entities && data.entities[wikidataId]) {
                const entity = data.entities[wikidataId];
                
                if (entity.labels && entity.labels.en) {
                    result.country = entity.labels.en.value;
                }
                
                if (entity.descriptions && entity.descriptions.en) {
                    result.description = entity.descriptions.en.value;
                }
                
                // For now, just get basic info without additional API calls
                if (entity.claims) {
                    if (entity.claims.P36 && entity.claims.P36[0]) {
                        const capitalId = entity.claims.P36[0].mainsnak.datavalue?.value?.id;
                        result.capital = capitalId ? `Capital: ${capitalId}` : null;
                    }
                    
                    if (entity.claims.P38 && entity.claims.P38[0]) {
                        const currencyId = entity.claims.P38[0].mainsnak.datavalue?.value?.id;
                        result.currency = currencyId ? `Currency: ${currencyId}` : null;
                    }
                }
            }
            
            // Cache for 5 minutes
            this.wikidataCache.set(wikidataId, result);
            setTimeout(() => {
                this.wikidataCache.delete(wikidataId);
            }, 300000);
            
            return result;
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Wikidata request timed out for:', wikidataId);
                throw new Error('Request timed out');
            }
            console.error('Wikidata fetch error:', error);
            throw error;
        }
    }

    // Get country info with Wikidata integration
    async getCountryInfoWithWikidata(countryFeature) {
        if (!countryFeature) return null;
        
        // Handle both old (properties) and new (direct) data structures
        const props = countryFeature.properties || countryFeature;
        const baseInfo = {
            name: props.name || props.sovereignt || props.admin,
            code: props.iso_a3 || props.sov_a3 || props.adm0_a3,
            code2: props.iso_a2 || props.adm0_a2,
            population: props.pop_est,
            gdp: props.gdp_md,
            continent: props.continent,
            region: props.region_un,
            subregion: props.subregion,
            incomeGroup: props.income_grp,
            economy: props.economy,
            formalName: props.formal_en,
            wikidataId: props.wikidataid
        };

        // If we have a Wikidata ID, fetch additional information
        if (props.wikidataid) {
            try {
                const wikidataInfo = await this.fetchWikidataInfo(props.wikidataid);
                return {
                    ...baseInfo,
                    wikidata: wikidataInfo
                };
            } catch (error) {
                console.warn('Failed to fetch Wikidata info for', baseInfo.name, error);
                return {
                    ...baseInfo,
                    wikidata: null
                };
            }
        }

        return baseInfo;
    }

    // Format the data for display including Wikidata information
    async formatCountryInfoWithWikidata(countryFeature) {
        const info = await this.getCountryInfoWithWikidata(countryFeature);
        if (!info) return null;

        const formatNumber = (num) => {
            if (!num) return 'N/A';
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        };

        const formatGDP = (gdp) => {
            if (!gdp) return 'N/A';
            if (gdp >= 1000000) {
                return '$' + (gdp / 1000000).toFixed(2) + ' trillion';
            } else if (gdp >= 1000) {
                return '$' + (gdp / 1000).toFixed(2) + ' billion';  
            } else {
                return '$' + gdp.toFixed(2) + ' million';
            }
        };

        const baseFormatted = {
            name: info.name,
            code: info.code,
            code2: info.code2,
            population: info.population ? formatNumber(info.population) : 'N/A',
            gdp: info.gdp ? formatGDP(info.gdp) : 'N/A',
            continent: info.continent,
            region: info.region,
            incomeGroup: info.incomeGroup,
            economy: info.economy,
            formalName: info.formalName
        };

        // Add Wikidata information if available
        if (info.wikidata) {
            return {
                ...baseFormatted,
                wikidata: {
                    capital: info.wikidata.capital,
                    currency: info.wikidata.currency,
                    language: info.wikidata.language,
                    description: info.wikidata.description,
                    wikidataUrl: info.wikidataId ? 'https://www.wikidata.org/wiki/' + info.wikidataId : null
                }
            };
        }

        return baseFormatted;
    }

    destroy() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        if (this.workerCallbacks.size > 0) {
            this.workerCallbacks.forEach(({ reject }) => {
                reject(new Error('Worker destroyed'));
            });
            this.workerCallbacks.clear();
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CountryDataManager;
}
