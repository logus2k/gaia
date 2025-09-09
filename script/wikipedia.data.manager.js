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

    // Initialize the worker with Wikidata capabilities
    initWorker() {
        if (this.worker) return;

        const workerCode = `
            let countryData = null;
            let loaded = false;
            let wikidataCache = new Map();

            self.onmessage = async function(e) {
                const { id, action, data } = e.data;
                
                try {
                    switch (action) {
                        case 'LOAD_DATA':
                            await loadData(data.url);
                            self.postMessage({ id, success: true, data: { loaded: true } });
                            break;
                            
                        case 'SEARCH_BY_NAME':
                            if (!loaded) throw new Error('Data not loaded');
                            const results = searchByName(data.term);
                            self.postMessage({ id, success: true, data: results });
                            break;
                            
                        case 'GET_BY_NAME':
                            if (!loaded) throw new Error('Data not loaded');
                            const country = getByName(data.name);
                            self.postMessage({ id, success: true, data: country });
                            break;
                            
                        case 'FETCH_WIKIDATA_INFO':
                            const wikidataInfo = await fetchWikidataInfo(data.wikidataId);
                            self.postMessage({ id, success: true, data: wikidataInfo });
                            break;
                            
                        default:
                            throw new Error('Unknown action: ' + action);
                    }
                } catch (error) {
                    self.postMessage({ 
                        id, 
                        success: false, 
                        error: error.message 
                    });
                }
            };

            async function loadData(url) {
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        throw new Error('HTTP error! status: ' + response.status);
                    }
                    countryData = await response.json();
                    loaded = true;
                } catch (error) {
                    console.error('Worker failed to load data:', error);
                    throw error;
                }
            }

            function searchByName(searchTerm) {
                if (!loaded || !searchTerm) return [];
                
                const term = searchTerm.toLowerCase();
                return countryData.features.filter(country => {
                    const props = country.properties;
                    const names = [
                        props.name,
                        props.name_long,
                        props.sovereignt,
                        props.formal_en,
                        props.admin,
                        props.name_en
                    ].filter(Boolean);
                    
                    return names.some(name => 
                        name.toLowerCase().includes(term)
                    );
                });
            }

            function getByName(exactName) {
                if (!loaded || !exactName) return null;
                
                return countryData.features.find(country => {
                    const props = country.properties;
                    return props.name === exactName || 
                           props.sovereignt === exactName ||
                           props.admin === exactName;
                }) || null;
            }

            async function fetchWikidataInfo(wikidataId) {
                if (!wikidataId) {
                    throw new Error('No Wikidata ID provided');
                }

                // Check cache first
                if (wikidataCache.has(wikidataId)) {
                    return wikidataCache.get(wikidataId);
                }

                try {
                    // Wikidata SPARQL endpoint
                    const sparqlQuery = 'SELECT ?countryLabel ?capitalLabel ?currencyLabel ?languageLabel ?area ?population ?gdp ?description ?flag ?coatOfArms WHERE { wd:' + wikidataId + ' rdfs:label ?countryLabel . OPTIONAL { wd:' + wikidataId + ' wdt:P36 ?capital . ?capital rdfs:label ?capitalLabel . } OPTIONAL { wd:' + wikidataId + ' wdt:P38 ?currency . ?currency rdfs:label ?currencyLabel . } OPTIONAL { wd:' + wikidataId + ' wdt:P37 ?language . ?language rdfs:label ?languageLabel . } OPTIONAL { wd:' + wikidataId + ' wdt:P2046 ?area . } OPTIONAL { wd:' + wikidataId + ' wdt:P1082 ?population . } OPTIONAL { wd:' + wikidataId + ' wdt:P2131 ?gdp . } OPTIONAL { wd:' + wikidataId + ' schema:description ?description . FILTER(LANG(?description) = "en") } OPTIONAL { wd:' + wikidataId + ' wdt:P41 ?flag . } OPTIONAL { wd:' + wikidataId + ' wdt:P237 ?coatOfArms . } FILTER(LANG(?countryLabel) = "en") SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }';

                    const url = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparqlQuery) + '&format=json';
                    
                    const response = await fetch(url, {
                        headers: {
                            'Accept': 'application/json',
                            'User-Agent': 'CountryDataManager/1.0'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error('Wikidata request failed: ' + response.status);
                    }
                    
                    const data = await response.json();
                    
                    // Process the results
                    let result = {
                        wikidataId: wikidataId,
                        country: null,
                        capital: null,
                        currency: null,
                        language: null,
                        area: null,
                        population: null,
                        gdp: null,
                        description: null,
                        flag: null,
                        coatOfArms: null
                    };
                    
                    if (data.results && data.results.bindings && data.results.bindings.length > 0) {
                        const binding = data.results.bindings[0];
                        result = {
                            wikidataId: wikidataId,
                            country: binding.countryLabel ? binding.countryLabel.value : null,
                            capital: binding.capitalLabel ? binding.capitalLabel.value : null,
                            currency: binding.currencyLabel ? binding.currencyLabel.value : null,
                            language: binding.languageLabel ? binding.languageLabel.value : null,
                            area: binding.area ? parseFloat(binding.area.value) : null,
                            population: binding.population ? parseInt(binding.population.value) : null,
                            gdp: binding.gdp ? parseFloat(binding.gdp.value) : null,
                            description: binding.description ? binding.description.value : null,
                            flag: binding.flag ? binding.flag.value : null,
                            coatOfArms: binding.coatOfArms ? binding.coatOfArms.value : null
                        };
                    }
                    
                    // Cache the result
                    wikidataCache.set(wikidataId, result);
                    return result;
                    
                } catch (error) {
                    console.error('Wikidata fetch error:', error);
                    throw error;
                }
            }
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        this.worker = new Worker(workerUrl);
        
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

    async loadData(url = 'http://localhost:6678/data/all.countries.geo.json') {
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

    // Fetch detailed information from Wikidata using the wikidataid
    async fetchWikidataInfo(wikidataId) {
        return this.sendMessageToWorker('FETCH_WIKIDATA_INFO', { wikidataId });
    }

    // Get country info with Wikidata integration
    async getCountryInfoWithWikidata(countryFeature) {
        if (!countryFeature) return null;
        
        const props = countryFeature.properties;
        const baseInfo = {
            name: props.name || props.sovereignt || props.admin,
            code: props.iso_a3 || props.sov_a3 || props.adm0_a3,
            code2: props.iso_a2 || props.adm0_a2,
            population: props.pop_est,
            gdp: props.gdp_md,
            area: props.area_km2,
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
            area: info.area ? formatNumber(info.area) + ' km²' : 'N/A',
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
