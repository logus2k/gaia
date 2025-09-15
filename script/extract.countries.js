import fs from 'fs';
import path from 'path';

// Configuration
const INPUT_FILE = '../data/all.countries.geo.json';  // Your full GeoJSON file
const OUTPUT_FILE = '../data/countries-basic.json';   // Smaller output file

function extractCountryData(inputFile, outputFile) {
    console.log(`Reading ${inputFile}...`);
    
    try {
        // Read the full GeoJSON file
        const rawData = fs.readFileSync(inputFile, 'utf8');
        const geoData = JSON.parse(rawData);
        
        console.log(`Found ${geoData.features.length} countries in source file`);
        
        // Extract only essential country properties
        const extractedCountries = geoData.features.map(feature => {
            const props = feature.properties;
            
            return {
                // Primary identifiers
                name: props.name,
                name_long: props.name_long,
                formal_en: props.formal_en,
                
                // Country codes
                iso_a2: props.iso_a2,
                iso_a3: props.iso_a3,
                
                // Alternative names for search
                sovereignt: props.sovereignt,
                admin: props.admin,
                name_en: props.name_en,
                abbrev: props.abbrev,
                postal: props.postal,
                
                // Geographic classification
                continent: props.continent,
                region_un: props.region_un,
                subregion: props.subregion,
                region_wb: props.region_wb,
                
                // Economic data
                pop_est: props.pop_est,
                pop_year: props.pop_year,
                gdp_md: props.gdp_md,
                gdp_year: props.gdp_year,
                income_grp: props.income_grp,
                economy: props.economy,
                
                // External identifiers
                wikidataid: props.wikidataid,
                
                // Classification
                type: props.type,
                featurecla: props.featurecla
            };
        });
        
        // Create the output structure
        const outputData = {
            type: "CountryCollection",
            info: {
                extractedFrom: INPUT_FILE,
                extractedAt: new Date().toISOString(),
                totalCountries: extractedCountries.length,
                note: "Simplified country data without geometry for fast loading"
            },
            countries: extractedCountries
        };
        
        // Write the extracted data
        fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2), 'utf8');
        
        // Calculate file sizes
        const inputStats = fs.statSync(inputFile);
        const outputStats = fs.statSync(outputFile);
        const inputSizeMB = (inputStats.size / 1024 / 1024).toFixed(2);
        const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
        const reduction = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);
        
        console.log(`\n✅ Extraction completed successfully!`);
        console.log(`📁 Input file: ${inputSizeMB} MB`);
        console.log(`📁 Output file: ${outputSizeMB} MB`);
        console.log(`📉 Size reduction: ${reduction}%`);
        console.log(`🏆 Extracted ${extractedCountries.length} countries`);
        console.log(`💾 Output saved to: ${outputFile}`);
        
        // Show sample of extracted data
        console.log(`\n📋 Sample of extracted data:`);
        console.log(JSON.stringify(extractedCountries[0], null, 2));
        
    } catch (error) {
        console.error('❌ Error during extraction:', error.message);
        
        if (error.code === 'ENOENT') {
            console.log(`\n💡 Make sure ${inputFile} exists in the current directory`);
        } else if (error instanceof SyntaxError) {
            console.log(`\n💡 The input file appears to have invalid JSON format`);
        }
        
        process.exit(1);
    }
}

// Validation function
function validateOutputData(outputFile) {
    try {
        const data = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        
        console.log('\n🔍 Validating output...');
        
        const issues = [];
        
        data.countries.forEach((country, index) => {
            if (!country.name && !country.sovereignt) {
                issues.push(`Country at index ${index} has no name`);
            }
            if (!country.iso_a3 && !country.iso_a2) {
                issues.push(`Country "${country.name}" has no country codes`);
            }
        });
        
        if (issues.length === 0) {
            console.log('✅ Output validation passed - all countries have essential data');
        } else {
            console.log('⚠️  Validation warnings:');
            issues.forEach(issue => console.log(`   - ${issue}`));
        }
        
    } catch (error) {
        console.error('❌ Validation failed:', error.message);
    }
}

// Main execution
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
    // Check if input file exists
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Input file ${INPUT_FILE} not found!`);
        console.log(`\n💡 Usage: node extract-countries.js`);
        console.log(`   Make sure ${INPUT_FILE} exists in the current directory`);
        process.exit(1);
    }
    
    console.log('🚀 Starting country data extraction...\n');
    
    extractCountryData(INPUT_FILE, OUTPUT_FILE);
    validateOutputData(OUTPUT_FILE);
    
    console.log(`\n🎯 Next steps:`);
    console.log(`   1. Update your CountryDataManager to load: ${OUTPUT_FILE}`);
    console.log(`   2. Modify the data structure handling (countries array instead of features)`);
    console.log(`   3. Test the new lightweight loading!`);
}

export { extractCountryData };
