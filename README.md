# 🛡️ דרך צלחה - Derech Tzlecha

מצא את המסלול הבטוח ביותר עם מקלטים ציבוריים בתל אביב.

Find the safest walking route with public shelters in Tel Aviv.

## 🌟 Features

- **Interactive Map**: View all public shelters in Tel Aviv on an interactive map
- **Safe Route Planning**: Plan walking routes that maximize proximity to shelters
- **Safety/Speed Balance**: Adjust the balance between route efficiency and safety
- **Multiple Route Options**: Compare different routes with safety metrics
- **Shelter Filtering**: Filter by shelter type (public, parking, accessible)
- **Mobile Responsive**: Works on both desktop and mobile devices
- **Hebrew Interface**: Full Hebrew language support

## 🚀 Live Demo

Visit: [https://timangames.github.io/derech-tzlecha/](https://timangames.github.io/derech-tzlecha/)

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (Static Export)
- **Map**: MapLibre GL JS
- **Routing**: OpenRouteService API
- **Geocoding**: Nominatim (OpenStreetMap)
- **Shelter Data**: Tel Aviv Municipality ArcGIS Layer 592
- **Spatial Index**: RBush (R-tree)
- **Geometry**: Turf.js

## 📊 Data Source

Shelter data is fetched from Tel Aviv-Yafo Municipality's public ArcGIS layer:
- Layer ID: 592 (מקלטים - Shelters)
- Includes: Public shelters, accessible shelters, parking shelters
- Real-time data from municipal GIS

## 🏃 Running Locally

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## 📱 Safety Metrics

Each route displays:
- **Distance**: Total walking distance in kilometers
- **Duration**: Estimated walking time
- **Shelters Near Route**: Number of shelters within 150m of the route
- **Max Gap**: Maximum distance from any point on the route to the nearest shelter

## ⚠️ Disclaimer

This application is for planning purposes only. During an emergency, always follow the instructions of the Home Front Command (פיקוד העורף).

- [Home Front Command Website](https://www.oref.org.il/)
- [Tel Aviv Municipality Emergency Info](https://www.tel-aviv.gov.il/)

## 📄 License

MIT License