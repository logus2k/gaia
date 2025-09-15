// Country Data Worker - Handles country data operations in background
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
                const countries = countryData.countries || countryData.features || [];
                self.postMessage({ id, success: true, data: countries });
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
        console.log('Worker loaded data:', countryData.info || 'GeoJSON format');
    } catch (error) {
        console.error('Worker failed to load data:', error);
        throw error;
    }
}

function searchByName(searchTerm) {
    if (!loaded || !searchTerm) return [];
    
    const term = searchTerm.toLowerCase();
    // Handle both old (features) and new (countries) data structures
    const countries = countryData.countries || countryData.features || [];
    
    return countries.filter(country => {
        // Handle both direct properties and nested properties structure
        const props = country.properties || country;
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
    
    // Handle both old (features) and new (countries) data structures
    const countries = countryData.countries || countryData.features || [];
    
    return countries.find(country => {
        // Handle both direct properties and nested properties structure
        const props = country.properties || country;
        return props.name === exactName || 
               props.sovereignt === exactName ||
               props.admin === exactName;
    }) || null;
}
