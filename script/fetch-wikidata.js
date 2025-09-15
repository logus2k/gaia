// fetch-wikidata-robust.js

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';


class WikidataFetcher {
    constructor() {
        this.countriesDataPath = path.join(process.cwd(), '..', 'data', 'countries-basic.json');
        this.outputDir = path.join(process.cwd(), '..', 'data', 'countries');
        this.delayBetweenRequests = 4000;
        this.fetchedCount = 0;
        this.errorCount = 0;
        this.existingFiles = new Set();
    }

    ensureOutputDir() {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
            console.log(`Created directory: ${this.outputDir}`);
        }
        
        // Check which files already exist to allow resuming
        if (fs.existsSync(this.outputDir)) {
            const files = fs.readdirSync(this.outputDir);
            files.forEach(file => {
                if (file.endsWith('.json') && file !== 'all-countries-raw.json') {
                    this.existingFiles.add(file.replace('.json', ''));
                }
            });
            console.log(`Found ${this.existingFiles.size} existing country files`);
        }
    }

    async fetchWikidataRaw(wikidataId) {
        const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json`;
        
        try {
            console.log(`Fetching data for ${wikidataId}...`);
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'CountryDataManager/1.0'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.entities && data.entities[wikidataId]) {
                return {
                    ...data,
                    _metadata: {
                        fetchedAt: new Date().toISOString(),
                        wikidataId: wikidataId,
                        url: url
                    }
                };
            } else {
                throw new Error(`No entity found for ID: ${wikidataId}`);
            }
        } catch (error) {
            console.error(`Error fetching ${wikidataId}:`, error.message);
            this.errorCount++;
            return null;
        }
    }

    getWikidataIds() {
        try {
            const rawData = fs.readFileSync(this.countriesDataPath);
            const countryData = JSON.parse(rawData);
            
            const wikidataIds = new Set();
            const countries = countryData.countries || countryData.features || [];
            
            countries.forEach(country => {
                const props = country.properties || country;
                if (props.wikidataid) {
                    wikidataIds.add(props.wikidataid);
                }
            });
            
            console.log(`Found ${wikidataIds.size} countries with Wikidata IDs`);
            return Array.from(wikidataIds);
        } catch (error) {
            console.error('Error reading country data:', error.message);
            process.exit(1);
        }
    }

    saveRawData(filename, data) {
        try {
            const filePath = path.join(this.outputDir, filename);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`Saved: ${filename}`);
        } catch (error) {
            console.error(`Error saving ${filename}:`, error.message);
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async fetchAllCountriesRaw() {
        console.log('Starting Wikidata fetch process...');
        this.ensureOutputDir();
        
        const wikidataIds = this.getWikidataIds();
        const results = [];
        
        // Filter out already downloaded files if resuming
        const idsToProcess = process.argv.includes('--resume') 
            ? wikidataIds.filter(id => !this.existingFiles.has(id))
            : wikidataIds;
            
        console.log(`Processing ${idsToProcess.length} countries`);
        
        for (let i = 0; i < idsToProcess.length; i++) {
            const id = idsToProcess[i];
            const data = await this.fetchWikidataRaw(id);
            
            if (data) {
                this.saveRawData(`${id}.json`, data);
                results.push(data);
                this.fetchedCount++;
            }
            
            if (i < idsToProcess.length - 1) {
                await this.delay(this.delayBetweenRequests);
            }
            
            if ((i + 1) % 10 === 0) {
                console.log(`Processed ${i + 1}/${idsToProcess.length} items`);
            }
        }
        
        if (results.length > 0) {
            this.saveRawData('all-countries-raw.json', results);
        }
        
        console.log('\n=== Fetching Complete ===');
        console.log(`Successfully fetched data for ${this.fetchedCount} countries`);
        console.log(`Failed to fetch data for ${this.errorCount} countries`);
        console.log(`Files saved in: ${this.outputDir}`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const fetcher = new WikidataFetcher();
    fetcher.fetchAllCountriesRaw().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export default WikidataFetcher;
