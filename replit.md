# Network Topology Manager - The Dude

A modern web-based network management application that replicates Mikrotik's The Dude functionality. Features an interactive canvas for Mikrotik and SNMP device topology mapping with drag-and-drop, multi-map support, and automatic device probing.

## Project Overview

This application provides:
- **Interactive Canvas**: Drag-and-drop network device placement with pan and zoom controls
- **Device Management**: Mikrotik router/switch and generic SNMP device support
- **Multi-Map Support**: Organize devices across different network segments
- **Auto-Probing**: Mock Mikrotik API and SNMP integration for device discovery
- **Real-time Visualization**: Device status indicators, connection topology, and search

## Tech Stack

**Frontend:**
- React with TypeScript
- Wouter for routing
- TanStack Query for data fetching
- Tailwind CSS + Shadcn UI components
- Source Sans Pro & Roboto fonts

**Backend:**
- Node.js + Express
- PostgreSQL (via Neon) with Drizzle ORM
- Mock device probing service (Mikrotik API & SNMP)

## Database Setup

The application uses PostgreSQL with three main tables:
- `maps` - Network topology maps
- `devices` - Network devices with position and probe data
- `connections` - Device-to-device connections

**Schema is automatically managed via Drizzle:**
```bash
npm run db:push  # Push schema changes to database
```

The DATABASE_URL environment variable is automatically configured by Replit.

## Getting Started

1. **Install dependencies** (done automatically):
```bash
npm install
```

2. **Database migrations** (already applied):
```bash
npm run db:push
```

3. **Start the application**:
```bash
npm run dev
```

The application runs on port 5000 with:
- Frontend: React SPA with Vite
- Backend: Express REST API at /api/*
- Database: PostgreSQL with Drizzle ORM

## Core Features Implemented

### Maps
- Create/read/delete network topology maps
- Switch between multiple maps
- Organize devices by network segment

### Devices
- Drag-and-drop device placement from library
- Device types: Mikrotik Router, Mikrotik Switch, Generic SNMP, Server, Access Point
- Auto-probing returns mock data:
  - Model, version, uptime
  - Network ports with status and speed
  - Device status (online, warning, offline, unknown)
- Search devices by name, IP, or type
- Edit and delete devices

### Canvas
- Pan and zoom controls
- Grid background with auto-expanding workspace
- Device nodes with status indicators
- Connection lines between devices
- Search highlighting with pulse animation

### UI/UX
- Professional network management aesthetic
- Dark/light theme toggle
- Device properties panel
- Empty states and loading indicators
- Responsive design

## API Endpoints

**Maps:**
- `GET /api/maps` - List all maps
- `POST /api/maps` - Create new map
- `DELETE /api/maps/:id` - Delete map

**Devices:**
- `GET /api/devices?mapId=xxx` - List devices for map
- `POST /api/devices` - Create device (auto-probes for data)
- `PATCH /api/devices/:id` - Update device
- `DELETE /api/devices/:id` - Delete device

**Connections:**
- `GET /api/connections?mapId=xxx` - List connections for map
- `POST /api/connections` - Create connection
- `DELETE /api/connections/:id` - Delete connection

## Design Guidelines

- **Primary Color**: #2C3E50 (network blue)
- **Secondary Color**: #34495E (slate)
- **Typography**: Source Sans Pro (primary), Roboto (UI)
- **Layout**: Fixed toolbar, collapsible panels, infinite canvas
- **Status Colors**: Green (online), Yellow (warning), Red (offline), Gray (unknown)

See `design_guidelines.md` for complete design specifications.

## Development

- TypeScript strict mode enabled
- React Query for data fetching and caching
- Drizzle ORM for type-safe database queries
- Zod for runtime validation
- All components use Shadcn UI primitives

## Future Enhancements (Next Phase)

- Real Mikrotik API integration (via node-routeros)
- Actual SNMP protocol support (via net-snmp)
- WebSocket for real-time device status updates
- Connection drawing between devices
- Device grouping and hierarchical organization
- Export/import network topology configurations
- Alert notifications for device status changes

## Project Structure

```
├── client/               # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── lib/         # Utilities and query client
│   │   └── hooks/       # Custom React hooks
├── server/              # Express backend
│   ├── db.ts           # Database connection
│   ├── storage.ts      # Data access layer
│   ├── routes.ts       # API endpoints
│   └── deviceProbe.ts  # Mock device probing
├── shared/             # Shared types and schemas
│   └── schema.ts       # Drizzle schema and Zod validation
└── design_guidelines.md # UI/UX specifications
```

## Notes

- Database is pre-provisioned with DATABASE_URL environment variable
- Mock device data simulates real Mikrotik and SNMP responses
- Canvas uses CSS transforms for pan/zoom operations
- Device positions stored in database for persistence
