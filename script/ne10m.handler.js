import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class NE10MHandler {
    constructor(searchIndexPath = '../data/ne_10m/index/search.index.json') {
        this.searchIndexPath = path.resolve(__dirname, searchIndexPath);
        this.searchIndex = null;
        this.searchIndexMap = new Map(); // For fast lookups
        this.initializeSearchIndex();
    }

    // Load the search index on startup and build search index map
    initializeSearchIndex() {
        try {
            if (fs.existsSync(this.searchIndexPath)) {
                const data = fs.readFileSync(this.searchIndexPath, 'utf8');
                this.searchIndex = JSON.parse(data);

                // Build search index map for faster lookups
                this.buildSearchIndexMap();

                console.log(`Loaded search index with ${this.searchIndex.length} entries`);
                console.log(`Built search index map with ${this.searchIndexMap.size} terms`);
            } else {
                throw new Error(`Search index file not found: ${this.searchIndexPath}`);
            }
        } catch (error) {
            console.error('Failed to initialize search index:', error.message);
            throw error;
        }
    }

    // Build inverted index for fast text search
    buildSearchIndexMap() {
        this.searchIndexMap.clear();

        this.searchIndex.forEach((entry, entryIndex) => {
            // Index all names for this entry
            const allNames = [entry.name, ...entry.names];

            allNames.forEach(name => {
                if (!name || typeof name !== 'string') return;

                // Normalize and tokenize
                const normalized = name.toLowerCase().trim();

                // Index whole terms
                this.addToIndex(normalized, entryIndex);

                // Index individual words for better matching
                const words = normalized.split(/\s+/);
                words.forEach(word => {
                    if (word.length > 1) {
                        this.addToIndex(word, entryIndex);
                    }
                });
            });
        });
    }

    // Helper to add terms to index
    addToIndex(term, entryIndex) {
        if (!this.searchIndexMap.has(term)) {
            this.searchIndexMap.set(term, new Set());
        }
        this.searchIndexMap.get(term).add(entryIndex);
    }

    // Health check endpoint
    healthCheck() {
        return {
            status: 'OK',
            message: 'NE10M Data API is running',
            timestamp: new Date().toISOString(),
            searchIndex: {
                loaded: !!this.searchIndex,
                entries: this.searchIndex ? this.searchIndex.length : 0,
                indexedTerms: this.searchIndexMap ? this.searchIndexMap.size : 0
            }
        };
    }

    // Search locations by query (countries and populated places)
    searchLocations(req) {
        const query = req.query.q;
        const type = req.query.type; // 'country', 'place', or undefined for both
        const limit = parseInt(req.query.limit) || 500;

        if (!query) {
            throw {
                status: 400,
                error: 'Query parameter required',
                message: 'Please provide a search query using the "q" parameter'
            };
        }

        if (!this.searchIndex || !this.searchIndexMap) {
            throw {
                status: 500,
                error: 'Search index not loaded',
                message: 'Search index is not available'
            };
        }

        try {
            const normalizedQuery = query.toLowerCase().trim();

            // Fast lookup using index
            let candidateIndices = new Set();

            // Get exact matches from index
            if (this.searchIndexMap.has(normalizedQuery)) {
                this.searchIndexMap.get(normalizedQuery).forEach(idx =>
                    candidateIndices.add(idx)
                );
            }

            // Get partial matches - check if query is substring of indexed terms
            for (const [term, indices] of this.searchIndexMap.entries()) {
                if (term.includes(normalizedQuery)) {
                    indices.forEach(idx => candidateIndices.add(idx));
                }
            }

            // Convert indices back to actual entries
            let candidates = Array.from(candidateIndices).map(idx => {
                const entry = this.searchIndex[idx];
                // Add relevance score
                const score = this.calculateRelevanceScore(entry, normalizedQuery);
                return { ...entry, score };
            });

            // Filter by type if specified
            if (type) {
                candidates = candidates.filter(entry => entry.type === type);
            }

            // Sort results: prioritize countries, then by relevance score
            candidates.sort((a, b) => {
                // If scores are different, sort by score (highest first)
                if (b.score !== a.score) {
                    return b.score - a.score;
                }

                // If scores are equal, prioritize countries over places
                if (a.type === 'country' && b.type !== 'country') {
                    return -1; // a (country) comes first
                }
                if (b.type === 'country' && a.type !== 'country') {
                    return 1; // b (country) comes first
                }

                // If both are same type, sort alphabetically
                return a.name.localeCompare(b.name);
            });

            // Limit results
            const results = candidates.slice(0, limit);

            return {
                query: query,
                type: type || 'all',
                count: results.length,
                limit: limit,
                results: results.map(result => ({
                    id: result.id,
                    type: result.type,
                    name: result.name,
                    countryCode: result.countryCode,
                    adminCode: result.adminCode,
                    placeType: result.placeType,
                    population: result.population,
                    adminRegion: result.adminRegion,
                    geometry: result.geometry,
                    score: Math.round(result.score * 100) / 100 // Round to 2 decimal places
                }))
            };
        } catch (error) {
            throw {
                status: 500,
                error: 'Error searching locations',
                message: error.message
            };
        }
    }

    // Calculate relevance score for search results
    calculateRelevanceScore(entry, query) {
        let score = 0;
        const normalizedQuery = query.toLowerCase();
        const normalizedName = entry.name.toLowerCase();

        // Exact match - highest priority
        if (normalizedName === normalizedQuery) {
            score += 10000;
        }
        // Starts with match - high priority
        else if (normalizedName.startsWith(normalizedQuery)) {
            score += 5000;
        }
        // Contains match - lower priority
        else if (normalizedName.includes(normalizedQuery)) {
            score += 1000;
        }

        // Type-specific boosts
        if (entry.placeType) {
            if (entry.placeType === 'Admin-0 capital') {
                score += 500;
            } else if (entry.placeType.includes('capital')) {
                score += 300;
            }
        }

        // Population boost (capped)
        if (entry.population && entry.population > 0) {
            score += Math.min(Math.log10(entry.population) * 10, 200);
        }

        // Country priority boost (ensures countries come first within same relevance level)
        if (entry.type === 'country') {
            score += 50000; // Very high boost to ensure countries always first
        }

        return score;
    }



    // Get detailed information for a specific location by ID
    async getLocationDetails(req) {
        const locationId = req.params.id;

        if (!locationId) {
            return {
                status: 400,
                error: 'Location ID required',
                message: 'Please provide a location ID'
            };
        }

        if (!this.searchIndex) {
            return {
                status: 500,
                error: 'Search index not loaded',
                message: 'Search index is not available'
            };
        }

        try {
            // Initialize response object
            const response = {
                id: locationId,
                message: 'Location details retrieved successfully',
                timestamp: new Date().toISOString()
            };

            // Find the location in search index to get country code and type
            const location = this.searchIndex.find(entry => entry.id === locationId);

            if (!location) {
                return {
                    status: 404,
                    error: 'Location not found',
                    message: `No location found with ID: ${locationId}`
                };
            }

            // Load data based on location type
            if (location.type === 'country') {
                await this.loadCountryData(location, response);
            } else if (location.type === 'place') {
                await this.loadPlaceData(location, response);
            }

            return response;
        } catch (error) {
            console.error(`Error retrieving location details for ID ${locationId}:`, error);
            return {
                status: 500,
                error: 'Error retrieving location details',
                message: error.message || 'An unexpected error occurred',
                id: locationId
            };
        }
    }

    // Load data for country locations
    async loadCountryData(location, response) {
        if (location.countryCode) {
            try {
                const wikipediaData = this.loadCountryDetailsFromSource(location.countryCode, 'iso31661');
                if (wikipediaData) {
                    // Extract content from first child of /query/pages
                    response.wikipedia = this.extractWikipediaContent(wikipediaData);
                }
            } catch (error) {
                console.warn(`Could not load wikipedia data for ${location.countryCode}:`, error.message);
            }

            try {
                const ne10mData = this.loadCountryDetailsFromSource(location.countryCode, 'ne_10m');
                if (ne10mData) {
                    response.ne_10m_countries = ne10mData;
                }
            } catch (error) {
                console.warn(`Could not load ne_10m data for ${location.countryCode}:`, error.message);
            }
        }
    }

    // Load data for place locations
    async loadPlaceData(location, response) {
        if (location.countryCode) {
            try {
                const placeData = this.loadPlaceDetailsFromSource(location.countryCode, location.id);
                if (placeData) {
                    response.populated_places = placeData;
                }
            } catch (error) {
                console.warn(`Could not load populated places data for ${location.countryCode}, place ${location.id}:`, error.message);
            }
        }
    }

    // Extract content from wikipedia API response
    extractWikipediaContent(wikipediaData) {
        try {
            // Check if this is a wikipedia API response with query/pages structure
            if (wikipediaData && wikipediaData.query && wikipediaData.query.pages) {
                const pages = wikipediaData.query.pages;
                const pageIds = Object.keys(pages);

                // Get the first page (there's usually only one)
                if (pageIds.length > 0) {
                    const firstPageId = pageIds[0];
                    const pageData = pages[firstPageId];

                    // Return the page content directly under wikipedia attribute
                    return pageData;
                }
            }

            // If not wikipedia API format, return as-is
            return wikipediaData;
        } catch (error) {
            console.warn('Error extracting wikipedia content:', error.message);
            return wikipediaData; // Return original data on error
        }
    }

    // Load detailed country data from specified source
    loadCountryDetailsFromSource(countryCode, source) {
        try {
            let sourcePath;

            switch (source) {
                case 'iso31661':
                    sourcePath = path.resolve(__dirname, '../data/ne_10m/iso31661/country_details_ORIGINAL');
                    break;
                case 'ne_10m':
                    sourcePath = path.resolve(__dirname, '../data/ne_10m/countries/extracted');
                    break;
                default:
                    throw new Error(`Unknown data source: ${source}`);
            }

            const countryFilePath = path.join(sourcePath, `${countryCode}.json`);

            if (fs.existsSync(countryFilePath)) {
                return JSON.parse(fs.readFileSync(countryFilePath, 'utf8'));
            } else {
                throw new Error(`Detailed data file not found for country: ${countryCode} in source: ${source}`);
            }
        } catch (error) {
            console.error(`Error loading detailed data for country ${countryCode} from source ${source}:`, error.message);
            throw error;
        }
    }

    // Load detailed place data from populated places source
    loadPlaceDetailsFromSource(countryCode, placeId) {
        try {
            const sourcePath = path.resolve(__dirname, '../data/ne_10m/populated_places/extracted');
            const countryFilePath = path.join(sourcePath, `${countryCode}.json`);

            if (fs.existsSync(countryFilePath)) {
                const countryData = JSON.parse(fs.readFileSync(countryFilePath, 'utf8'));

                // Find the specific place by NE_ID within the country data
                if (countryData.features) {
                    const placeFeature = countryData.features.find(feature =>
                        feature.properties && feature.properties.NE_ID &&
                        feature.properties.NE_ID.toString() === placeId.toString()
                    );

                    if (placeFeature) {
                        return placeFeature;
                    } else {
                        throw new Error(`Place with NE_ID ${placeId} not found in ${countryCode}.json`);
                    }
                } else {
                    throw new Error(`Invalid data format in ${countryCode}.json - no features array`);
                }
            } else {
                throw new Error(`Detailed data file not found for country: ${countryCode} in populated places source`);
            }
        } catch (error) {
            console.error(`Error loading detailed data for place ${placeId} from country ${countryCode}:`, error.message);
            throw error;
        }
    }

    // Get all locations for a specific country
    getCountryLocations(countryCode) {
        if (!this.searchIndex) {
            throw {
                status: 500,
                error: 'Search index not loaded',
                message: 'Search index is not available'
            };
        }

        try {
            const locations = this.searchIndex.filter(entry =>
                entry.countryCode === countryCode
            );

            return {
                countryCode: countryCode,
                count: locations.length,
                locations: locations
            };
        } catch (error) {
            throw {
                status: 500,
                error: 'Error retrieving country locations',
                message: error.message
            };
        }
    }

    // Serve country flag SVG file
    getCountryFlag(req, res) {
        const countryCode = req.params.countryCode;
        
        if (!countryCode) {
            res.status(400).json({
                status: 400,
                error: 'Country code required',
                message: 'Please provide a 2-letter country code'
            });
            return;
        }
        
        // Validate country code format (2 letters)
        const normalizedCode = countryCode.toLowerCase();
        if (!/^[a-z]{2}$/.test(normalizedCode)) {
            res.status(400).json({
                status: 400,
                error: 'Invalid country code',
                message: 'Country code must be exactly 2 letters'
            });
            return;
        }
        
        try {
            const flagsPath = path.resolve(__dirname, '../data/ne_10m/flags/4x3');
            const flagFilePath = path.join(flagsPath, `${normalizedCode}.svg`);
            
            // Check if file exists
            if (!fs.existsSync(flagFilePath)) {
                res.status(404).json({
                    status: 404,
                    error: 'Flag not found',
                    message: `Flag for country code ${countryCode} not found`
                });
                return;
            }
            
            // Set appropriate headers for SVG
            res.setHeader('Content-Type', 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
            
            // Send the file
            res.sendFile(flagFilePath, (err) => {
                if (err) {
                    console.error(`Error serving flag ${countryCode}:`, err);
                    // Only send error response if headers haven't been sent yet
                    if (!res.headersSent) {
                        res.status(500).json({
                            status: 500,
                            error: 'Error serving flag',
                            message: 'Failed to serve flag file'
                        });
                    }
                }
            });
            
        } catch (error) {
            console.error(`Error serving flag for ${countryCode}:`, error);
            res.status(500).json({
                status: 500,
                error: 'Error serving flag',
                message: error.message || 'An unexpected error occurred'
            });
        }
    }

    // Get search index statistics
    getStatistics() {
        if (!this.searchIndex) {
            return {
                loaded: false,
                message: 'Search index not loaded'
            };
        }

        const countryCount = new Set(
            this.searchIndex.filter(entry => entry.type === 'country')
                .map(entry => entry.countryCode)
        ).size;

        const placeCount = this.searchIndex.filter(entry => entry.type === 'place').length;

        const countriesWithPlaces = new Set(
            this.searchIndex.filter(entry => entry.type === 'place')
                .map(entry => entry.countryCode)
        ).size;

        return {
            loaded: true,
            totalEntries: this.searchIndex.length,
            indexedTerms: this.searchIndexMap.size,
            countries: countryCount,
            places: placeCount,
            countriesWithPlaces: countriesWithPlaces,
            types: {
                countries: this.searchIndex.filter(e => e.type === 'country').length,
                places: this.searchIndex.filter(e => e.type === 'place').length
            }
        };
    }

    // Rebuild the search index (useful if search.index.json is updated)
    rebuildIndex() {
        try {
            this.initializeSearchIndex();
            return {
                status: 'success',
                message: 'Search index rebuilt successfully',
                entries: this.searchIndex.length,
                indexedTerms: this.searchIndexMap.size
            };
        } catch (error) {
            throw {
                status: 500,
                error: 'Error rebuilding search index',
                message: error.message
            };
        }
    }
}

export default NE10MHandler;
