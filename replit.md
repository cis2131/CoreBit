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

The application uses PostgreSQL with six main tables:
- `maps` - Network topology maps
- `devices` - Global network devices (independent of maps)
- `device_placements` - Junction table linking devices to maps with positions
- `connections` - Device-to-device connections (map-specific)
- `credential_profiles` - Reusable credential profiles for device authentication
- `settings` - Application settings (polling interval, etc.)

**Global Device Model**: Devices are stored globally and can be placed on multiple maps via the `device_placements` junction table. This allows the same physical device to appear on different network topology maps.

**Schema is automatically managed via Drizzle:**
```bash
npm run db:push  # Push schema changes to database
```

The DATABASE_URL environment variable is automatically configured by Replit.

**⚠️ SECURITY NOTE**: Credentials are currently stored in plaintext in the database. For production deployment, implement encryption at rest using a solution like AWS KMS, HashiCorp Vault, or pgcrypto.

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
- **Global device library**: Devices exist independently and can be placed on multiple maps
- **Drag-and-drop from sidebar**: Drag devices from the left sidebar onto any map
- **Add new devices**: Create devices via "Add Device" button in toolbar
- Device types: Mikrotik Router, Mikrotik Switch, Generic SNMP, Server, Access Point
- Real-time device probing with actual data:
  - Model, version, uptime from Mikrotik API / SNMP
  - Network ports with status and speed
  - CPU and memory usage from device APIs
  - Device status (online, warning, offline, unknown)
- Parallel probing service (80 concurrent probes, 400+ device scale)
- Search devices by name, IP, or type
- Edit devices (global changes apply to all maps)
- Delete from map (removes placement only) or delete globally (removes device everywhere)
- Duplicate placement prevention (same device can't be placed twice on same map)

### Canvas
- Pan and zoom controls with mouse wheel zoom
- Fit-to-canvas button (calculates bounding box of all devices including negative coordinates)
- Grid background with auto-expanding workspace
- **Flexible positioning**: Supports negative coordinates, allowing devices to be placed outside top/left boundaries
- **Snap to grid**: Hold Shift while dragging to snap devices to 20px grid alignment
- Device nodes with status indicators
- Connection lines between devices with interface descriptions
- Search highlighting with pulse animation

### UI/UX
- Professional network management aesthetic
- Collapsible left sidebar with global device library
- "Add Device" button in top toolbar
- Dark/light theme toggle
- Device properties panel
- Empty states and loading indicators
- Responsive design

## API Endpoints

**Maps:**
- `GET /api/maps` - List all maps
- `POST /api/maps` - Create new map
- `DELETE /api/maps/:id` - Delete map

**Devices (Global):**
- `GET /api/devices` - List all devices
- `POST /api/devices` - Create device (auto-probes for data)
- `PATCH /api/devices/:id` - Update device
- `DELETE /api/devices/:id` - Delete device globally (cascades placements)

**Device Placements (Map-specific):**
- `GET /api/placements/:mapId` - List device placements for map
- `POST /api/placements` - Place device on map (validates no duplicates)
- `PATCH /api/placements/:id` - Update placement position
- `DELETE /api/placements/:id` - Remove device from map (auto-cleans connections)

**Connections (Map-specific):**
- `GET /api/connections/:mapId` - List connections for map
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

## Parallel Probing Architecture

The application uses a high-performance parallel probing system designed to handle 400+ devices within a 30-second polling interval:

**Configuration:**
- 80 concurrent device probes
- 6-second per-device timeout wrapper
- 5-second Mikrotik API timeout
- 4-second SNMP timeout with 0 retries

**Features:**
- Bounded-concurrency queue maintains exactly 80 active probes
- Non-overlapping probe scheduling with re-entry guard
- Timeout protection prevents hung probes from blocking the queue
- Storage update guard prevents late-arriving completions from writing after timeout
- Comprehensive telemetry: success rate, timeout count, error count, cycle duration

**Performance:**
- Worst-case: ceil(400/80) × 6s = 30 seconds for 400 offline devices
- Typical case: Much faster for responsive devices (1-2s for online devices)
- Scales linearly with device count up to the concurrency limit

**Link Speed Detection (Mikrotik):**
The system uses optimized two-tier link speed detection to handle 400+ device fleets efficiently:

**Implementation:**
- Quick probes (every cycle): Fast device status check without detailed interface monitoring
- Detailed probes (every 10 cycles): Runs `/interface ethernet monitor` command to get actual link speeds
- Smart caching: Speeds stored in `deviceData.ports` and reused between detailed probes
- State change detection: Down→up link transitions trigger immediate detailed probe for fresh speed data

**Performance characteristics:**
- Quick cycle: ~1.1s for responsive devices (status check only)
- Detailed cycle: ~2.9s per device (includes 3s `/interface ethernet monitor` overhead)
- Frequency: Detailed monitoring every 10 cycles (~5 minutes with 30s polling interval)
- Scalability: Prevents detailed monitoring from blocking the 400+ device fleet by running it selectively

**Speed parsing:**
- Primary field: RouterOS `speed` property (e.g., "1Gbps", "100Mbps")
- Fallback: Legacy `rate` property for older firmware
- Caching ensures speeds persist between detailed monitoring cycles

## Future Enhancements (Next Phase)

- WebSocket for real-time device status updates (push vs. poll)
- Device grouping and hierarchical organization
- Export/import network topology configurations
- Alert notifications for device status changes
- Historical performance graphs (CPU/memory trends over time)
- Network traffic monitoring on connections

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
│   ├── routes.ts       # API endpoints & probing service
│   └── deviceProbe.ts  # Real Mikrotik & SNMP probing
├── shared/             # Shared types and schemas
│   └── schema.ts       # Drizzle schema and Zod validation
└── design_guidelines.md # UI/UX specifications
```

## Recent Architecture Changes

**Global Device Model (November 2025):**
- Migrated from map-specific devices to global device library
- Devices can now appear on multiple maps via `device_placements` junction table
- Left sidebar shows all devices, draggable onto any map
- Duplicate placement prevention ensures a device only appears once per map
- Connection cleanup automatically removes connections when device is removed from map
- Cache invalidation ensures real-time UI updates for placements and connections

## Notes

- Database is pre-provisioned with DATABASE_URL environment variable
- Real device probing via Mikrotik API (node-routeros) and SNMP (net-snmp)
- Canvas uses CSS transforms for pan/zoom operations
- Device positions stored in `device_placements` table for persistence across maps
- Parallel probing service automatically starts on application launch and probes all global devices
