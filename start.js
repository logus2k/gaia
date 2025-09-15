import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// Import the CountryDataHandler
import CountryDataHandler from "./script/country.data.handler.js";

const app = express();
const PORT = 6678;

// Resolve directory of start.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize country data handler
const countryHandler = new CountryDataHandler();

// Serve everything under start.js root
app.use(express.static(__dirname));

// Add country data API endpoints
app.get('/api/health', (req, res) => {
  try {
    const result = countryHandler.healthCheck(req, res);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

app.get('/api/countries', (req, res) => {
  try {
    const result = countryHandler.listCountries(req, res);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

app.get('/api/country/:name', (req, res) => {
  try {
    const result = countryHandler.getCountry(req, res);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

app.get('/api/search', (req, res) => {
  try {
    const result = countryHandler.searchCountries(req, res);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

// Add static files middleware for direct country file access
app.use('/api/data/countries', countryHandler.staticFilesMiddleware.bind(countryHandler));

// Fallback: if no file is found, return 404
app.use((req, res) => {
  res.status(404).send("File not found");
});

app.listen(PORT, () => {
  console.log(`Static server running at http://localhost:${PORT}`);
  console.log(`Country data API available at http://localhost:${PORT}/api`);
});
