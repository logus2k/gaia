# GAIA: The Interactive Earth Visualization Platform

**Gaia** is a high-performance web application that runs STT/TTS/LLM AI services locally, it supports rendering a dynamic 3D model of Earth, integrates real-time geospatial data, and provides a seamless handoff to a detailed zoom-in to 2D mapping interface. It functions as a powerful tool for visualizing global geography, time-of-day dynamics, and country-specific data, while taking advantage of modern AI tooling available.

-----

## Key Features

  * **Dynamic 3D Globe:** Renders a realistic, interactive 3D globe using **Three.js**, complete with high-resolution day/night textures, clouds, and a celestial background.
  * **Realistic Solar Dynamics:** Calculates the **Sun's true solar position** based on the current time and location to apply accurate directional lighting, simulating realistic time-of-day and shadow boundaries.
  * **Seamless 3D/2D Handoff:** Automatically transitions the user from the 3D globe to a standard 2D map view (powered by **MapLibre**) when a high zoom threshold is crossed, and back to 3D when zooming out.
  * **Geospatial Data Overlay:** Loads and processes GeoJSON data to provide an indexed database of country boundaries for selection and highlighting.
  * **Interactive Callouts:** Displays real-time location details—including country name, ISO codes, and local solar time—for any point clicked on the globe.
  * **Real-Time Telemetry:** Features a mini-globe overlay that displays live metrics such as camera altitude, rotation speed, and critical time data (UTC, Local Solar Time, Next Sunset).
  * **Local AI Integration (STT/TTS/LLM):** Integrates a full, local AI stack for advanced voice control and natural language querying. All AI components, including Speech-to-Text, Text-to-Speech, and the Large Language Model, run entirely on the user's local system for maximum privacy and low-latency interaction. 

-----

## AI Architecture

The intelligence layer of Gaia is built on a **privacy-first, local architecture** designed for high responsiveness.

The entire AI pipeline, from voice input to synthesized response, is processed locally:

1.  **STT (Speech-to-Text):** The **STT Server** converts user voice commands into text input.
2.  **LLM (Large Language Model):** The local LLM processes the user's query, interpreting complex natural language to perform searches, manipulate the globe's view, or retrieve specific data points.
3.  **TTS (Text-to-Speech):** The **TTS Server** converts the LLM's text response into audible output, providing verbal feedback to the user.

This approach ensures no user voice data or query content is ever transmitted to external cloud providers.

-----

## Technical Dependencies

Gaia is built upon a modern stack of open-source JavaScript libraries and custom local AI services.

| Dependency | Purpose | Repository Link |
| :--- | :--- | :--- |
| **Three.js** | Core WebGL 3D rendering engine. | [github.com/mrdoob/three.js](https://www.google.com/search?q=https://github.com/mrdoob/three.js) |
| **OrbitControls** | Camera controls for interactive navigation of the 3D scene. | *(Included in Three.js examples)* |
| **MapLibre GL JS** | Rendering and handling of the 2D geospatial map view. | [github.com/maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) |
| **SunCalcUTC** | Precise calculations for solar position, sunset, and solar time. | *(A customized version of SunCalc used for UTC calculations)* |
| **STT Server** | Provides the local **Speech-to-Text** service for voice command input. | [github.com/logus2k/stt\_server](https://github.com/logus2k/stt_server) |
| **TTS Server** | Provides the local **Text-to-Speech** service for audible feedback. | [github.com/logus2k/tts\_server](https://github.com/logus2k/tts_server) |
| **Local LLM Backend** | Runs a **Large Language Model** locally for natural language processing and complex querying. | *(Utilizes a common local framework e.g., Llama.cpp)* |

-----

## How It Works

### The 3D Engine

The application uses **Three.js** to construct a scene containing a spherical mesh for the Earth, to which multiple textures are applied (day, night, clouds). A key technical implementation is the **solar light engine**:

1.  The `updateSunFromSolarTimeOncePerSecond` function calculates the Sun's azimuth and altitude.
2.  A `THREE.DirectionalLight` (`dirLight`) is positioned according to this calculation.
3.  This dynamically shifts the lighting across the globe, ensuring the terminator line (the boundary between day and night) is always accurate for the current time.

### 3D to 2D Handoff

Gaia maintains two rendering contexts: a 3D Three.js canvas and a 2D MapLibre map container.

  * When the 3D camera's distance from the globe falls below a predefined threshold (`HANDOFF_Z_IN`), the 3D view is hidden, and the 2D map is made visible (`showMap2D`).
  * The 2D map is then synchronized, centering the view and setting the zoom level to match the former 3D view.
  * Conversely, zooming the 2D map out beyond a threshold triggers a transition back to the 3D globe (`hideMap2D`). This mechanism ensures users always have the most appropriate visualization for their current level of zoom.

-----

### License

This project's license is Apache 2.0.

---
