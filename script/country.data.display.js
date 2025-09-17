export class CountryDataDisplay {

    constructor(propsList, propsBox, pickedInfo) {
        this.propsList = propsList;
        this.propsBox = propsBox;
        this.pickedInfo = pickedInfo;
        this.expandedSections = new Set(['basic', 'geography']); // Default expanded sections
    }

    async showPicked(latDeg, lonDeg, country) {
        const latTxt = this.formatLat(latDeg);
        const lonTxt = this.formatLon(lonDeg);
        
        if (country) {
            this.pickedInfo.textContent = `${latTxt}, ${lonTxt} · ${country.name}${country.iso3 ? ` (${country.iso3})` : ''}`;
            
            // Clear previous props
            this.propsList.innerHTML = '';
            
            try {
                // Fetch detailed country data from API
                const response = await fetch(`/api/country/${encodeURIComponent(country.name)}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const countryData = await response.json();
                
                // Render the country data in an organized way
                this.renderCountryData(countryData);
                
            } catch (error) {
                console.error('Error fetching country data:', error);
                // Fallback to original properties if API fails
                this.renderFallbackProperties(country);
            }
            
            this.propsBox.classList.remove('hidden');
        } else {
            this.pickedInfo.textContent = `${latTxt}, ${lonTxt} · Ocean / no country match`;
            this.propsBox.classList.add('hidden');
            this.propsList.innerHTML = '';
        }

        return country; // Return the country for further processing
    }

    renderCountryData(countryData) {
        // Clear previous props
        this.propsList.innerHTML = '';
        
        // Create a container for better organization
        const container = document.createElement('div');
        container.className = 'country-data-container';
        
        // Create property groups with their keys
        const groups = {
            basic: {
                title: 'Basic Information',
                properties: ['country', 'abbreviation', 'capital', 'city'],
                hasFlag: true,
                showTitle: false
            },
            geography: {
                title: 'Geography',
                properties: ['continent', 'location', 'area', 'coastline', 'elevation', 'north', 'south', 'east', 'west', 'temperature']
            },
            demographics: {
                title: 'Demographics',
                properties: ['population', 'density', 'expectancy', 'height', 'religion', 'languages']
            },
            government: {
                title: 'Government',
                properties: ['government', 'independence', 'iso', 'landlocked']
            },
            culture: {
                title: 'Culture',
                properties: ['dish', 'symbol', 'side']
            },
            economy: {
                title: 'Economy',
                properties: ['currency_name', 'currency_code']
            },
            communications: {
                title: 'Communications',
                properties: ['calling_code', 'tld', 'barcode']
            },
            cities: {
                title: 'Cities',
                properties: ['cities'],
                isSpecial: true
            }
        };
        
        // Add groups in order
        this.appendPropertyGroup('basic', groups.basic, countryData, container);
        this.appendPropertyGroup('geography', groups.geography, countryData, container);
        this.appendPropertyGroup('demographics', groups.demographics, countryData, container);
        this.appendPropertyGroup('government', groups.government, countryData, container);
        this.appendPropertyGroup('culture', groups.culture, countryData, container);
        this.appendPropertyGroup('economy', groups.economy, countryData, container);
        this.appendPropertyGroup('communications', groups.communications, countryData, container);
        
        // Special handling for cities
        if (countryData.cities && Array.isArray(countryData.cities)) {
            this.appendCitiesGroup('cities', groups.cities, countryData, container);
        }
        
        this.propsList.appendChild(container);
    }

    appendPropertyGroup(groupKey, groupConfig, countryData, container) {
        const { title, properties, hasFlag, showTitle } = groupConfig;
        const hasData = properties.some(prop => countryData[prop] !== undefined && countryData[prop] !== null);
        
        if (!hasData) return;
        
        const group = document.createElement('div');
        group.className = 'property-group';
        group.dataset.groupKey = groupKey;
        
        // Create group header with toggle button
        const groupHeader = document.createElement('div');
        groupHeader.className = 'property-group-header';
        groupHeader.style.display = 'flex';
        groupHeader.style.justifyContent = 'space-between';
        groupHeader.style.alignItems = 'center';
        groupHeader.style.margin = '12px 0 8px 0';
        groupHeader.style.cursor = 'pointer';
        
        const titleElement = document.createElement('h3');
        titleElement.textContent = title;
        titleElement.style.margin = '0';
        titleElement.style.fontSize = '13px';
        titleElement.style.opacity = '0.9';
        
        const toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-btn';
        toggleButton.innerHTML = this.expandedSections.has(groupKey) ? 
            '&#9660;' : '&#9658;'; // Down arrow for expanded, right arrow for collapsed
        toggleButton.style.background = 'none';
        toggleButton.style.border = 'none';
        toggleButton.style.color = '#fff';
        toggleButton.style.cursor = 'pointer';
        toggleButton.style.padding = '2px 6px';
        toggleButton.style.fontSize = '12px';
        toggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSection(groupKey, contentElement, toggleButton);
        });
        
        groupHeader.appendChild(titleElement);
        groupHeader.appendChild(toggleButton);

        // Add flag to basic group if available
        let flagElement = null;
        if (hasFlag && countryData.flag_base64) {
            flagElement = document.createElement('img');
            flagElement.src = countryData.flag_base64;
            flagElement.alt = `${countryData.country} flag`;
            flagElement.style.maxWidth = '100%';
            flagElement.style.maxHeight = '100px';
            flagElement.style.marginBottom = '12px';
            flagElement.style.border = '1px solid rgba(255,255,255,0.2)';
        }
        
        // Create content area
        const contentElement = document.createElement('div');
        contentElement.className = 'property-group-content';
        contentElement.style.display = this.expandedSections.has(groupKey) ? 'block' : 'none';
        
        // Add flag if this is the basic group
        if (flagElement) {
            contentElement.appendChild(flagElement);
        }
        
        const dl = document.createElement('dl');
        dl.style.display = 'grid';
        dl.style.gridTemplateColumns = 'auto 1fr';
        dl.style.gap = '6px 10px';
        dl.style.margin = '0';
        
        properties.forEach(prop => {
            if (countryData[prop] !== undefined && countryData[prop] !== null) {
                
                const dt = document.createElement('dt');
                dt.textContent = this.formatPropertyName(prop);
                dt.style.opacity = '0.8';
                
                const dd = document.createElement('dd');
                dd.style.margin = '0';
                dd.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
                
                if (Array.isArray(countryData[prop])) {
                    dd.textContent = countryData[prop].join(', ');
                } else {
                    dd.textContent = this.formatPropertyValue(prop, countryData[prop]);
                }
                
                dl.appendChild(dt);
                dl.appendChild(dd);
            }
        });
        
        contentElement.appendChild(dl);
        
        group.appendChild(groupHeader);
        group.appendChild(contentElement);
        container.appendChild(group);
        
        // Add click event to header to toggle section
        groupHeader.addEventListener('click', () => {
            this.toggleSection(groupKey, contentElement, toggleButton);
        });
    }

    appendCitiesGroup(groupKey, groupConfig, countryData, container) {
        const { title } = groupConfig;
        
        const group = document.createElement('div');
        group.className = 'property-group';
        group.dataset.groupKey = groupKey;
        
        // Create group header with toggle button
        const groupHeader = document.createElement('div');
        groupHeader.className = 'property-group-header';
        groupHeader.style.display = 'flex';
        groupHeader.style.justifyContent = 'space-between';
        groupHeader.style.alignItems = 'center';
        groupHeader.style.margin = '12px 0 8px 0';
        groupHeader.style.cursor = 'pointer';
        
        const titleElement = document.createElement('h3');
        titleElement.textContent = title;
        titleElement.style.margin = '0';
        titleElement.style.fontSize = '13px';
        titleElement.style.opacity = '0.9';
        
        const toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-btn';
        toggleButton.innerHTML = this.expandedSections.has(groupKey) ? 
            '&#9660;' : '&#9658;'; // Down arrow for expanded, right arrow for collapsed
        toggleButton.style.background = 'none';
        toggleButton.style.border = 'none';
        toggleButton.style.color = '#fff';
        toggleButton.style.cursor = 'pointer';
        toggleButton.style.padding = '2px 6px';
        toggleButton.style.fontSize = '12px';
        toggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleSection(groupKey, contentElement, toggleButton);
        });
        
        groupHeader.appendChild(titleElement);
        groupHeader.appendChild(toggleButton);
        
        // Create content area
        const contentElement = document.createElement('div');
        contentElement.className = 'property-group-content';
        contentElement.style.display = this.expandedSections.has(groupKey) ? 'block' : 'none';
        
        const citiesContainer = document.createElement('div');
        citiesContainer.style.maxHeight = '100px';
        citiesContainer.style.overflowY = 'auto';
        citiesContainer.style.padding = '6px';
        citiesContainer.style.background = 'rgba(255,255,255,0.05)';
        citiesContainer.style.borderRadius = '6px';
        citiesContainer.style.fontSize = '11px';
        
        // Show first 5 cities with a count of total
        const displayCities = countryData.cities.slice(0, 5);
        displayCities.forEach(city => {
            const cityEl = document.createElement('div');
            cityEl.textContent = city;
            cityEl.style.padding = '2px 0';
            citiesContainer.appendChild(cityEl);
        });
        
        if (countryData.cities.length > 5) {
            const moreEl = document.createElement('div');
            moreEl.textContent = `... and ${countryData.cities.length - 5} more`;
            moreEl.style.opacity = '0.7';
            moreEl.style.fontStyle = 'italic';
            moreEl.style.marginTop = '4px';
            citiesContainer.appendChild(moreEl);
        }
        
        contentElement.appendChild(citiesContainer);
        
        group.appendChild(groupHeader);
        group.appendChild(contentElement);
        container.appendChild(group);
        
        // Add click event to header to toggle section
        groupHeader.addEventListener('click', () => {
            this.toggleSection(groupKey, contentElement, toggleButton);
        });
    }

    toggleSection(groupKey, contentElement, toggleButton) {
        if (this.expandedSections.has(groupKey)) {
            // Collapse the section
            this.expandedSections.delete(groupKey);
            contentElement.style.display = 'none';
            toggleButton.innerHTML = '&#9658;'; // Right arrow
        } else {
            // Expand the section
            this.expandedSections.add(groupKey);
            contentElement.style.display = 'block';
            toggleButton.innerHTML = '&#9660;'; // Down arrow
        }
    }

    formatPropertyName(prop) {
        const names = {
            country: 'Country',
            abbreviation: 'Abbreviation',
            height: 'Avg. Height',
            barcode: 'Barcode Prefix',
            calling_code: 'Calling Code',
            city: 'Capital',
            cities: 'Cities',
            coastline: 'Coastline (km)',
            continent: 'Continent',
            currency_code: 'Currency Code',
            currency_name: 'Currency',
            tld: 'Domain TLD',
            side: 'Driving Side',
            elevation: 'Elevation (m)',
            flag_base64: 'Flag',
            north: 'Northernmost',
            south: 'Southernmost',
            west: 'Westernmost',
            east: 'Easternmost',
            government: 'Government',
            independence: 'Independence Year',
            iso: 'ISO Numeric',
            landlocked: 'Landlocked',
            languages: 'Languages',
            expectancy: 'Life Expectancy',
            dish: 'National Dish',
            symbol: 'National Symbol',
            density: 'Population Density',
            population: 'Population',
            location: 'Region',
            religion: 'Religion',
            area: 'Area (km²)',
            temperature: 'Avg. Temperature (°C)'
        };
        
        return names[prop] || prop.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    formatPropertyValue(prop, value) {
        switch (prop) {
            case 'area':
                return new Intl.NumberFormat().format(value) + ' km²';
            case 'population':
                return new Intl.NumberFormat().format(value);
            case 'density':
                return new Intl.NumberFormat().format(Math.round(value * 10) / 10) + '/km²';
            case 'temperature':
                return value + '°C';
            case 'elevation':
                return new Intl.NumberFormat().format(value) + ' m';
            case 'coastline':
                return new Intl.NumberFormat().format(value) + ' km';
            case 'height':
                return value + ' cm';
            case 'independence':
                return value.toString();
            case 'landlocked':
                return value === '1' || value === 1 ? 'Yes' : 'No';
            case 'side':
                return value === 'right' ? 'Right-hand traffic' : 'Left-hand traffic';
            default:
                return String(value);
        }
    }

    renderFallbackProperties(country) {
        // Fallback to original properties if API fails
        const p = country.feature.properties || {};
        const preferred = ['ADMIN', 'NAME_LONG', 'NAME', 'BRK_NAME', 'FORMAL_EN', 'ABBREV', 'ISO_A2', 'ISO_A3', 'CONTINENT', 'SUBREGION', 'REGION_UN', 'POP_EST', 'GDP_MD_EST'];
        const seen = new Set();
        
        for (const k of preferred) {
            if (p[k] != null) { 
                this.appendProp(k, p[k]); 
                seen.add(k); 
            }
        }
        
        // Fill a few more generic properties
        let extraCount = 0;
        for (const k in p) {
            if (seen.has(k)) continue;
            if (extraCount >= 20) break;
            const v = p[k];
            if (v != null && typeof v !== 'object') { 
                this.appendProp(k, v); 
                extraCount++; 
            }
        }
    }

    appendProp(k, v) {
        const dt = document.createElement('dt'); 
        dt.textContent = k;
        const dd = document.createElement('dd'); 
        dd.textContent = String(v);
        this.propsList.appendChild(dt); 
        this.propsList.appendChild(dd);
    }

    formatLat(lat) { const a = Math.abs(lat).toFixed(3); return lat >= 0 ? `${a}° N` : `${a}° S`; }
    formatLon(lon) { let L = ((lon + 540) % 360) - 180; const a = Math.abs(L).toFixed(3); return L >= 0 ? `${a}° E` : `${a}° W`; }
}
