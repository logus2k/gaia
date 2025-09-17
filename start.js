// Add this to your start.js file:

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// Import the NE10M Data Handler
import NE10MHandler from "./script/ne10m.handler.js";

const app = express();
const PORT = 6678;

// Resolve directory of start.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize NE10M data handler
const ne10mHandler = new NE10MHandler();

// Serve everything under start.js root
app.use(express.static(__dirname));

// Add NE10M data API endpoints
app.get('/api/health', (req, res) => {
  try {
    const result = ne10mHandler.healthCheck();
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

app.get('/api/search', (req, res) => {
  try {
    const result = ne10mHandler.searchLocations(req, res);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

app.get('/api/location/:id', (req, res) => {
  try {
    const result = ne10mHandler.getLocationDetails(req, res);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json(error);
  }
});

// ✅ ADD THIS: Serve the search index file
app.get('/api/search-index', (req, res) => {
  const searchIndexPath = path.join(__dirname, './data/ne_10m/index/search.index.json');
  res.sendFile(searchIndexPath, (err) => {
    if (err) {
      res.status(404).json({ 
        error: 'Search index not found', 
        message: 'The search index file is not available' 
      });
    }
  });
});

// Fallback: if no file is found, return 404
app.use((req, res) => {
  res.status(404).send("File not found");
});

app.listen(PORT, () => {
  console.log(`Application server running at http://localhost:${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
});
