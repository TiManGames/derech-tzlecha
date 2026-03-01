# Derech Tzlecha - דרך צלחה

Find the safest walking route with public shelters in Tel Aviv.

מצא את המסלול הבטוח ביותר עם מקלטים ציבוריים

ערים נתמכות:

- תל אביב
- ירושליים

## Features

### Route Planning
- **Safe Route Calculation**: Plan walking routes that maximize proximity to shelters
- **Address Autocomplete**: Get suggestions while typing addresses
- **Click on Map**: Set origin/destination by clicking directly on the map
- **Shelter Filtering**: Filter by shelter type (public, parking, accessible)

### Emergency Features
- **SOS Button**: Instantly find and navigate to the nearest shelter from your current location
- **Navigate to Shelter**: Click on any shelter marker to get walking directions from your location

### Live Location
- **Real-time Tracking**: Blue pulsing dot shows your current position on the map
- **Direction Indicator**: Shows your heading direction when moving (mobile only)
- **Accuracy Circle**: Visual indicator of GPS accuracy
- **Auto-center**: Map automatically centers on your location when first detected

### User Interface
- **Interactive Map**: View all public shelters in Tel Aviv on an interactive map
- **Minimizable Panel**: Collapsible control panel for better map visibility on mobile
- **Mobile Responsive**: Optimized for both desktop and mobile devices
- **Hebrew Interface**: Full Hebrew language support (RTL)

## Live Demo

Visit: [https://timangames.github.io/derech-tzlecha/](https://timangames.github.io/derech-tzlecha/)

## Tech Stack

- **Framework**: Next.js 14 (Static Export)
- **Map**: MapLibre GL JS
- **Routing**: OpenRouteService API
- **Geocoding**: Nominatim (OpenStreetMap)
- **Shelter Data**: Tel Aviv Municipality ArcGIS Layer 592
- **Spatial Index**: RBush (R-tree)
- **Geometry**: Turf.js

## Data Source

Shelter data is fetched from Tel Aviv-Yafo Municipality's public ArcGIS layer:
- Layer ID: 592 (Shelters - מקלטים)
- Includes: Public shelters, accessible shelters, parking shelters
- Real-time data from municipal GIS

## Running Locally

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Safety Metrics

Each route displays:
- **Distance**: Total walking distance in kilometers
- **Duration**: Estimated walking time
- **Shelters Near Route**: Number of shelters within 150m of the route
- **Time to Shelter**: Walking time range to reach the nearest shelter from any point on the route

## Disclaimer

This application is for planning purposes only. During an emergency, always follow the instructions of the Home Front Command (פיקוד העורף).

- [Home Front Command Website](https://www.oref.org.il/)
- [Tel Aviv Municipality Emergency Info](https://www.tel-aviv.gov.il/)

## Credits

Made by [Rom Bernheimer](https://www.linkedin.com/in/rom-bernheimer-9364b9174/)

## License

MIT License