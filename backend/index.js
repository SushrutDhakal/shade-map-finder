const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 5174; // avoid vite default 5173

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  const shadeMapApiKey = process.env.SHADEMAP_API_KEY;
  const openRouteServiceApiKey = process.env.ORS_API_KEY;
  
  if (!shadeMapApiKey || !openRouteServiceApiKey) {
    return res.status(500).json({ 
      error: 'API keys not configured. Please set SHADEMAP_API_KEY and ORS_API_KEY environment variables.' 
    });
  }
  
  res.json({ shadeMapApiKey, openRouteServiceApiKey });
});

// Geocoding proxy to avoid CORS issues
app.get('/api/geocode', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter required' });
    }

    const openRouteServiceApiKey = process.env.ORS_API_KEY;
    
    if (!openRouteServiceApiKey) {
      return res.status(500).json({ error: 'ORS_API_KEY not configured' });
    }
    
    const response = await fetch(
      `https://api.openrouteservice.org/geocode/search?api_key=${openRouteServiceApiKey}&text=${encodeURIComponent(q)}&size=5&layers=address,venue,street&sources=osm`
    );
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Geocoding proxy error:', error);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

