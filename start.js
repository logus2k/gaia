// start.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = 6678;

// Resolve directory of start.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve everything under start.js root
app.use(express.static(__dirname));

// Fallback: if no file is found, return 404
app.use((req, res) => {
  res.status(404).send("File not found");
});

app.listen(PORT, () => {
  console.log(`Static server running at http://localhost:${PORT}`);
});
