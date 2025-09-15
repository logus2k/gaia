import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


class CountryDataHandler {

    constructor(countriesDir = '../data/countries/consolidated') {
        this.countriesDir = path.resolve(__dirname, countriesDir);
        this.setupRoutes();
    }
    
    setupRoutes() {
        // This will be used to register routes with your existing server
        this.routes = {
            '/health': this.healthCheck.bind(this),
            '/countries': this.listCountries.bind(this),
            '/country/:name': this.getCountry.bind(this),
            '/search': this.searchCountries.bind(this)
        };
    }
    
    // Health check endpoint
    healthCheck(req, res) {
        return {
            status: 'OK', 
            message: 'Country Data API is running',
            timestamp: new Date().toISOString()
        };
    }
    
    // Get all available countries
    listCountries(req, res) {
        try {
            const files = fs.readdirSync(this.countriesDir);
            const countries = files.map(file => {
                const countryName = file.replace('.json', '').replace(/_/g, ' ');
                return {
                    name: countryName,
                    filename: file,
                    url: `/country/${encodeURIComponent(countryName)}`
                };
            });
            
            return {
                count: countries.length,
                countries: countries
            };
        } catch (error) {
            throw {
                status: 500,
                error: 'Could not read countries directory',
                message: error.message 
            };
        }
    }
    
    // Get country data by name
    getCountry(req, res) {
        const countryName = req.params.name;
        const safeFileName = countryName.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
        const filePath = path.join(this.countriesDir, safeFileName);
        
        if (!fs.existsSync(filePath)) {
            throw {
                status: 404,
                error: 'Country not found',
                message: `No data found for country: ${countryName}` 
            };
        }
        
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            throw {
                status: 500,
                error: 'Error reading country data',
                message: error.message 
            };
        }
    }
    
    // Search countries by query
    searchCountries(req, res) {
        const query = req.query.q;
        
        if (!query) {
            throw {
                status: 400,
                error: 'Query parameter required',
                message: 'Please provide a search query using the "q" parameter' 
            };
        }
        
        try {
            const files = fs.readdirSync(this.countriesDir);
            const results = files
                .map(file => {
                    const countryName = file.replace('.json', '').replace(/_/g, ' ');
                    return { name: countryName, filename: file };
                })
                .filter(country => 
                    country.name.toLowerCase().includes(query.toLowerCase())
                )
                .map(country => ({
                    ...country,
                    url: `/country/${encodeURIComponent(country.name)}`
                }));
            
            return {
                query: query,
                count: results.length,
                results: results
            };
        } catch (error) {
            throw {
                status: 500,
                error: 'Error searching countries',
                message: error.message 
            };
        }
    }
    
    // Get the route handlers for integration with your server
    getRoutes() {
        return this.routes;
    }
    
    // Middleware for serving static country files
    staticFilesMiddleware(req, res, next) {
        const basePath = '/data/countries';
        
        if (req.path.startsWith(basePath)) {
            const filename = req.path.substring(basePath.length);
            const filePath = path.join(this.countriesDir, filename);
            
            if (fs.existsSync(filePath)) {
                try {
                    const data = fs.readFileSync(filePath, 'utf8');
                    res.setHeader('Content-Type', 'application/json');
                    res.send(data);
                    return;
                } catch (error) {
                    res.status(500).json({ 
                        error: 'Error reading file',
                        message: error.message 
                    });
                    return;
                }
            } else {
                res.status(404).json({ 
                    error: 'File not found',
                    message: `Country file not found: ${filename}` 
                });
                return;
            }
        }
        
        next();
    }
}

export default CountryDataHandler;
