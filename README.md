# ShadeMap Walking Route Optimizer

A React-based web application that helps users find the most shaded walking routes between two points using real-time shadow data.

## Features

- 🌳 **Shade-Optimized Routing**: Find routes with maximum shade coverage
- ⚡ **Fastest Route**: Get the quickest path between destinations
- 🗺️ **Interactive Map**: Built with Leaflet and ShadeMap integration
- ⏰ **Time-Based Shadows**: Adjust time of day to see how shadows change
- 🚶 **Walking Directions**: Optimized specifically for pedestrian routes
- 🔍 **Address Search**: Google Maps-like search with autocomplete

## Quick Start

### Development

1. **Start the backend server:**
   ```bash
   cd backend
   npm install
   npm start
   ```

2. **Start the frontend:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. **Open your browser:**
   - Frontend: http://localhost:5173
   - Backend: http://localhost:5174

### Production Deployment

1. **Build and deploy:**
   ```bash
   ./deploy.sh
   cd deployment
   npm install
   npm start
   ```

2. **Environment Variables (optional):**
   ```bash
   export SHADEMAP_API_KEY=your_shademap_key
   export ORS_API_KEY=your_ors_key
   export PORT=3000
   ```

## How It Works

### Shade-Optimized Routing

The app generates two types of routes:

1. **Fastest Route**: Direct path from A to B
2. **Shadiest Route**: Detours through shaded areas using strategic waypoints

### Smart Waypoint Generation

- **Sun-Aware Positioning**: Places waypoints on the shaded side based on time of day
- **Morning (6AM-12PM)**: Routes to the west side (away from eastern sun)
- **Afternoon (12PM-6PM)**: Routes to the east side (away from western sun)
- **Distance-Based**: Only adds waypoints for routes longer than 500m

### Shadow Analysis

- Real-time shadow data from ShadeMap API
- Time-based shadow calculations
- Route-specific shade scoring
- Performance-optimized sampling

## API Keys

The app uses two main APIs:

1. **ShadeMap API**: For real-time shadow data
2. **OpenRouteService API**: For routing and geocoding

API keys are configured in the backend server.

## Technical Stack

- **Frontend**: React, TypeScript, Leaflet, Vite
- **Backend**: Node.js, Express
- **APIs**: ShadeMap, OpenRouteService
- **Maps**: Leaflet with OpenStreetMap

## Performance Optimizations

- Debounced search and shadow updates
- Optimized shadow sampling (15 points max)
- Lazy loading of building data
- Production build with console.log removal
- Code splitting and vendor chunking

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

MIT License - see LICENSE file for details.
