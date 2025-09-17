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
    
    // Search locations by query (countries and populated places) - OPTIMIZED
    searchLocations(req) {
        const query = req.query.q;
        const type = req.query.type; // 'country', 'place', or undefined for both
        const limit = parseInt(req.query.limit) || 50;
        
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
            
            // Sort by relevance score (highest first)
            candidates.sort((a, b) => b.score - a.score);
            
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
        
        // Exact name match (highest score)
        if (entry.name.toLowerCase() === query) {
            score += 100;
        }
        
        // Exact match in names array
        if (entry.names.some(name => name.toLowerCase() === query)) {
            score += 80;
        }
        
        // Starts with match in main name
        if (entry.name.toLowerCase().startsWith(query)) {
            score += 60;
        }
        
        // Starts with match in names array
        if (entry.names.some(name => name.toLowerCase().startsWith(query))) {
            score += 50;
        }
        
        // Contains match in main name
        if (entry.name.toLowerCase().includes(query)) {
            score += 30;
        }
        
        // Contains match in names array
        if (entry.names.some(name => name.toLowerCase().includes(query))) {
            score += 20;
        }
        
        // Boost for capital cities
        if (entry.placeType && entry.placeType.includes('capital')) {
            score += 15;
        }
        
        // Boost for Admin-0 capitals (country capitals)
        if (entry.placeType && entry.placeType === 'Admin-0 capital') {
            score += 10;
        }
        
        // Boost for higher population (logarithmic scale)
        if (entry.population && entry.population > 0) {
            score += Math.log10(entry.population) / 10;
        }
        
        // Small boost for countries over places
        if (entry.type === 'country') {
            score += 5;
        }
        
        return score;
    }
    
    // Get detailed information for a specific location by ID
    getLocationDetails(req) {
        const locationId = req.params.id;
        
        if (!locationId) {
            throw {
                status: 400,
                error: 'Location ID required',
                message: 'Please provide a location ID' 
            };
        }
        
        if (!this.searchIndex) {
            throw {
                status: 500,
                error: 'Search index not loaded',
                message: 'Search index is not available' 
            };
        }
        
        try {
            // Find the location in the search index
            const location = this.searchIndex.find(entry => entry.id === locationId);
            
            if (!location) {
                throw {
                    status: 404,
                    error: 'Location not found',
                    message: `No location found with ID: ${locationId}` 
                };
            }
            
            // Return the full location details
            return {
                ...location,
                message: 'Location details retrieved successfully',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            if (error.status) throw error; // Re-throw our custom errors
            
            throw {
                status: 500,
                error: 'Error retrieving location details',
                message: error.message 
            };
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
