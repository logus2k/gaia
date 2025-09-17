// location.search.client.js

export class LocationSearchClient {

    constructor(searchIndexUrl = '/api/search-index', baseApiUrl = '/api') {
        this.searchIndexUrl = searchIndexUrl;
        this.baseApiUrl = baseApiUrl;
        this.searchIndex = null;
        this.searchTrie = new Trie();
        this.isInitialized = false;
    }

    /**
     * Initialize the search client by loading the search index
     */
    async initialize() {
        if (this.isInitialized) return this.searchIndex;
        
        try {
            const response = await fetch(this.searchIndexUrl);
            if (!response.ok) {
                throw new Error(`Failed to load search index: ${response.status}`);
            }
            
            this.searchIndex = await response.json();
            this.buildSearchIndex();
            this.isInitialized = true;
            
            console.log(`Location search client initialized with ${this.searchIndex.length} entries`);
            return this.searchIndex;
        } catch (error) {
            console.error('Failed to initialize location search client:', error);
            throw error;
        }
    }

    /**
     * Build trie-based search index for efficient searching
     */
    buildSearchIndex() {
        this.searchTrie = new Trie();

        this.searchIndex.forEach((entry, entryIndex) => {
            entry.names.forEach(name => {
                if (name && typeof name === 'string') {
                    this.searchTrie.insert(name.trim(), entryIndex);
                }
            });
        });
    }

    /**
     * Search for locations by query (exact prefix matching)
     */
    search(query, options = {}) {
        const { limit = 50, type = 'all' } = options;
        
        if (!this.isInitialized) {
            throw new Error('Search client not initialized. Call initialize() first.');
        }
        
        if (!query || typeof query !== 'string') {
            return [];
        }
        
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) {
            return [];
        }
        
        // Use trie for efficient prefix search
        const indices = this.searchTrie.searchPrefix(normalizedQuery);
        
        // Get unique entries with their matching names
        const results = [];
        const seenIds = new Set();
        
        for (const index of indices) {
            const entry = this.searchIndex[index];
            if (entry && !seenIds.has(entry.id)) {
                // Find the exact name that matched the prefix
                const matchingNames = entry.names.filter(name => 
                    name.toLowerCase().startsWith(normalizedQuery)
                );
                
                if (matchingNames.length > 0) {
                    // Filter by type if specified
                    if (type !== 'all' && entry.type !== type) continue;
                    
                    seenIds.add(entry.id);
                    
                    // Use the first matching name as the display name for this entry
                    const displayName = matchingNames[0];
                    
                    results.push({
                        id: entry.id,
                        type: entry.type,
                        name: displayName,  // Use the matching name, not the primary name!
                        countryCode: entry.countryCode,
                        score: this.calculateRelevanceScore(displayName, normalizedQuery)
                    });
                }
            }
        }
        
        // Sort by relevance score (higher first)
        results.sort((a, b) => b.score - a.score);
        
        // Return results (limit to requested number)
        return results.slice(0, limit).map(result => ({
            id: result.id,
            type: result.type,
            name: result.name,
            countryCode: result.countryCode
        }));
    }

    /**
     * Calculate relevance score for search results
     */
    calculateRelevanceScore(matchingName, query) {
        let score = 0;
        
        const normalizedMatchingName = matchingName.toLowerCase();
        const normalizedQuery = query.toLowerCase();
        
        // Exact match gets highest score
        if (normalizedMatchingName === normalizedQuery) {
            score += 1000;
        }
        // Exact prefix match
        else if (normalizedMatchingName.startsWith(normalizedQuery)) {
            score += 100;
            // Boost shorter matches (more specific)
            score += Math.max(0, 50 - normalizedMatchingName.length);
        }
        
        return score;
    }

    /**
     * Get detailed information for a specific location by ID
     */
    async getLocationDetails(locationId) {
        if (!locationId) {
            throw new Error('Location ID is required');
        }
        
        try {
            const response = await fetch(`${this.baseApiUrl}/location/${encodeURIComponent(locationId)}`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`Location not found: ${locationId}`);
                }
                throw new Error(`Failed to fetch location details: ${response.status}`);
            }
            
            const locationDetails = await response.json();
            return locationDetails;
        } catch (error) {
            console.error(`Error fetching details for location ${locationId}:`, error);
            throw error;
        }
    }

    /**
     * Get statistics about the search index
     */
    getStatistics() {
        if (!this.isInitialized) {
            return { initialized: false, message: 'Not initialized' };
        }
        
        const countryCount = new Set(
            this.searchIndex
                .filter(entry => entry.type === 'country')
                .map(entry => entry.countryCode)
        ).size;
        
        const placeCount = this.searchIndex.filter(entry => entry.type === 'place').length;
        
        return {
            initialized: true,
            totalEntries: this.searchIndex.length,
            countries: countryCount,
            places: placeCount,
            types: {
                countries: this.searchIndex.filter(e => e.type === 'country').length,
                places: this.searchIndex.filter(e => e.type === 'place').length
            }
        };
    }

    /**
     * Check if the search client is ready
     */
    isReady() {
        return this.isInitialized;
    }
}

// Trie implementation for efficient prefix search
class TrieNode {
    constructor() {
        this.children = {};
        this.entries = new Set();
    }
}

class Trie {
    constructor() {
        this.root = new TrieNode();
    }

    insert(word, entryIndex) {
        let node = this.root;
        for (const char of word.toLowerCase()) {
            if (!node.children[char]) {
                node.children[char] = new TrieNode();
            }
            node = node.children[char];
            node.entries.add(entryIndex);
        }
    }

    searchPrefix(prefix) {
        let node = this.root;
        for (const char of prefix.toLowerCase()) {
            if (!node.children[char]) {
                return [];
            }
            node = node.children[char];
        }
        return Array.from(node.entries);
    }
}
