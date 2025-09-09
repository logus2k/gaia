class CountryDataManager {
    constructor() {
        this.countryData = null;
        this.loaded = false;
        this.loadingPromise = null;
        this.worker = null;
        this.workerCallbacks = new Map();
        this.messageId = 0;
    }

    // Initialize the worker with your specific dataset structure
    initWorker() {
        if (this.worker) return;

        const workerCode = `
            let countryData = null;
            let loaded = false;

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
                            
                        case 'GET_ALL_COUNTRIES':
                            if (!loaded) throw new Error('Data not loaded');
                            self.postMessage({ id, success: true, data: countryData.features });
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
                        props.name_en,
                        props.name_es,
                        props.name_fr,
                        props.name_de
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

    async loadData(url = "http://localhost:6678/data/all.countries.geo.json") {
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

    // Extract the specific information you need from the dataset
    getCountryInfo(countryFeature) {
        if (!countryFeature) return null;
        
        const props = countryFeature.properties;
        return {
            name: props.name || props.sovereignt || props.admin,
            code: props.iso_a3 || props.sov_a3 || props.adm0_a3,
            code2: props.iso_a2 || props.adm0_a2,
            population: props.pop_est,
            gdp: props.gdp_md, // GDP in millions of dollars
            area: props.area_km2, // You might need to calculate this or find it in the full dataset
            continent: props.continent,
            region: props.region_un,
            subregion: props.subregion,
            incomeGroup: props.income_grp,
            economy: props.economy,
            formalName: props.formal_en,
            abbreviation: props.abbrev,
            postal: props.postal,
            gdpYear: props.gdp_year,
            popYear: props.pop_year
        };
    }

    // Format the data for display
    formatCountryInfo(countryFeature) {
        const info = this.getCountryInfo(countryFeature);
        if (!info) return null;

        return {
            name: info.name,
            code: info.code,
            code2: info.code2,
            population: info.population ? info.population.toLocaleString() : 'N/A',
            gdp: info.gdp ? `$${(info.gdp / 1000).toFixed(2)} billion` : 'N/A', // Convert millions to billions
            area: info.area ? `${info.area.toLocaleString()} km²` : 'N/A',
            continent: info.continent,
            region: info.region,
            incomeGroup: info.incomeGroup,
            economy: info.economy
        };
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
