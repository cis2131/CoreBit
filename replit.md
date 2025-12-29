# CoreBit - Network Topology Manager

## Overview

CoreBit is a modern, web-based network management application inspired by Mikrotik's original "The Dude" functionality. It provides an interactive canvas for mapping network topology, managing Mikrotik and generic SNMP devices, and visualizing real-time device status.

The project aims to offer a professional-grade tool for network administrators to efficiently monitor, map, and manage their network infrastructure. Key capabilities include drag-and-drop device placement, multi-map support for organizing network segments, and automated device probing for discovery and status updates.

## User Preferences

I prefer clear, concise explanations and direct answers. For coding, I favor an iterative development approach with frequent, small commits. Please ask for confirmation before implementing major architectural changes or significant feature modifications. I value detailed explanations when new concepts or complex solutions are introduced.

## System Architecture

The application is built with a client-server architecture.

**Frontend:**
-   **Technology:** React with TypeScript, Wouter for routing, TanStack Query for data fetching.
-   **Styling:** Tailwind CSS with Shadcn UI components for a modern, professional network management aesthetic.
-   **Typography:** Source Sans Pro (primary) and Roboto (UI) fonts.
-   **UI/UX Decisions:** Features a fixed toolbar, collapsible panels, and an infinite canvas. Status indicators use Green (online), Yellow (warning), Red (offline), Gray (unknown) color scheme. Supports dark/light theme toggle, empty states, and loading indicators.
-   **Canvas:** Interactive canvas with pan, zoom, grid background, flexible positioning (including negative coordinates), and snap-to-grid functionality. Device nodes display status indicators, and connection lines include interface descriptions. Search functionality highlights devices with a pulse animation.

**Backend:**
-   **Technology:** Node.js with Express.
-   **Database:** PostgreSQL (via Neon) managed with Drizzle ORM.
-   **Core Logic:** Implements a mock Mikrotik API and SNMP probing service for device discovery and data collection.

**System Design Choices:**
-   **Global Device Model:** Devices are stored globally and can be placed on multiple maps via a `device_placements` junction table, allowing a single physical device to appear on different network topology maps.
-   **Parallel Probing Service:** High-performance system for real-time device status updates, capable of probing 400+ devices within a 30-second interval using 80 concurrent probes. Includes timeout protection and optimized link speed detection for Mikrotik devices (quick and detailed probes).
-   **Device Types:** Supports multiple device types:
    -   **Mikrotik Router/Switch:** Uses Mikrotik API for detailed monitoring (ports, system info, link speeds)
    -   **Generic SNMP Device:** Uses SNMP for device monitoring with ping fallback
    -   **Prometheus Device:** Scrapes Prometheus node_exporter (port 9100) for Linux server monitoring - gets CPU, memory, disk, uptime, and network interfaces
    -   **Ping Only Device:** For devices without SNMP/API support - monitored via 2 concurrent ICMP pings for reliability
    -   **Server/Access Point:** SNMP-based monitoring with appropriate icons
-   **Offline Threshold:** All device types respect configurable offline threshold - devices only go offline after N consecutive failed probes (default 3), preventing notification spam from transient failures.
-   **Network Scanner:** Automated discovery of devices on IP ranges (CIDR/Range support), multi-credential support, auto-detection of device types, scan profile saving, and bulk device creation.
-   **Traffic Monitoring:** Real-time traffic monitoring on connections. Supports two methods:
    -   **SNMP:** For Mikrotik, generic SNMP devices. Uses stored SNMP interface indexes for fast OID construction.
    -   **Prometheus/node_exporter:** For Linux servers running node_exporter. Uses `node_network_receive_bytes_total` and `node_network_transmit_bytes_total` metrics.
    -   Automatically detects which method to use based on device type (`generic_prometheus`) or credentials.
-   **Prometheus Metrics Historical Monitoring:** Stores and visualizes historical data for custom Prometheus metrics:
    -   `prometheus_metrics_history` table stores time-series data with composite index on (deviceId, metricId, timestamp)
    -   Custom metrics collected during each probe cycle are automatically stored
    -   PrometheusMetricsChartViewer component provides interactive charts with time range selection (1h, 3h, 6h, 12h, 24h)
    -   Auto-refresh every 30 seconds for real-time monitoring
    -   Metric-specific formatting (percentages for load metrics, bytes/seconds for network metrics)
    -   Retention policy respects global metricsRetentionHours setting
    -   Click on any custom metric in DevicePropertiesPanel to view its historical chart
-   **Backup & Restore:** Provides manual and scheduled backups with configurable retention policies. Supports downloading, uploading, and restoring full application data, including devices, maps, connections, credentials, and settings. Backup files are JSON-formatted and stored locally.
-   **On-Duty Notification System:** Simplified shift-based notification system with direct user-to-shift assignments:
    -   Two shifts: Day and Night, with configurable start/end times and timezone
    -   Users are directly assigned to shifts (no teams) via Settings
    -   Devices have a `useOnDuty` boolean flag - when enabled, alerts go to on-duty operators in addition to global notifications
    -   Global notifications and on-duty notifications can be active simultaneously for redundancy
    -   On-duty checkbox appears in Device Properties Panel under Notifications section
-   **Alarm Muting System:** Allows admins/superusers to temporarily silence alarm notifications:
    -   Global mutes: Mute all alarms for everyone (userId is null)
    -   Per-user mutes: Mute alarms for specific on-duty operators
    -   Configurable durations: 1h, 3h, 10h, 24h, or Forever
    -   Automatic cleanup of expired mutes
    -   OnDutyPanel component in device sidebar shows current on-duty users and mute status
    -   Permission-gated: Only Admin/Superuser roles can create or delete mutes
-   **Dynamic Connections (Proxmox VM Migration):** Connections can be marked as "dynamic" to automatically update when VMs migrate between Proxmox cluster nodes:
    -   `isDynamic` boolean flag on connections table enables automatic resolution
    -   `dynamicType` specifies the connection type (currently `proxmox_vm_host`)
    -   `dynamicMetadata` JSON stores VM device ID, monitored end, and last resolved host node
    -   `proxmox_nodes` table maps cluster node names to host device IDs
    -   When a VM migrates (detected during Proxmox probe), dynamic connections are automatically repointed to the new host device
    -   Migration events are logged with timestamps and source/destination nodes

**Technical Implementations:**
-   TypeScript strict mode.
-   React Query for data fetching and caching.
-   Drizzle ORM for type-safe database queries.
-   Zod for runtime validation.

## Deployment System

The project includes a complete deployment system for production servers:

-   **One-line Install:** `curl -fsSL https://your-server.com/corebit/install.sh | sudo bash`
-   **Kickstart Script:** `deploy/kickstart.sh` - Automated installer that handles:
    -   Node.js and PostgreSQL installation
    -   Database setup with secure credentials
    -   Systemd service configuration
    -   Environment file generation
    -   Updates via `--update` flag
-   **Build Script:** `deploy/build-release.sh` - Creates distributable zip/tar.gz packages
-   **Systemd Service:** `deploy/corebit.service` - Production service file
-   **Documentation:** `DEPLOYMENT.md` - Complete deployment guide

**Snap-to-Grid:** Default ON (devices snap to 20px grid), hold Shift for free placement.

## Upgrade Notes

**Automatic Interface Deduplication:**
When upgrading from older versions, the application automatically cleans up any duplicate device interface records at startup. This is necessary because:
-   Older versions could create duplicate interfaces during concurrent device probing
-   A unique constraint on `(deviceId, name)` now prevents duplicates at the database level
-   The cleanup runs silently unless duplicates are found, then logs the count of cleaned records
-   The most recently seen interface is kept, older duplicates are deleted

## Disaster Recovery

**Admin Password Reset:**
If you're locked out of the admin account, you can reset the password using environment variables:

1. Set `ADMIN_RECOVERY_SECRET=<any-8+-character-secret>` in your `.env` file
2. Optionally set `ADMIN_RECOVERY_PASSWORD=<your-new-password>` (otherwise a random password is generated)
3. Restart the application
4. Check the console logs for the new password (printed on startup)
5. Log in with the new credentials
6. **IMPORTANT:** Remove `ADMIN_RECOVERY_SECRET` from `.env` and restart the app

Example `.env` configuration:
```
ADMIN_RECOVERY_SECRET=resetmypassword123
ADMIN_RECOVERY_PASSWORD=MyNewSecurePassword
```

The recovery feature is only active when `ADMIN_RECOVERY_SECRET` is set. Always remove it after recovery for security.

## Licensing System

CoreBit uses a flexible, multi-license model:

-   **Free Tier:** Fully functional, limited to 10 devices
-   **Pro Tier:** Unlimited devices, 1 year of update entitlement
-   **Device Pack Tier:** Stackable +10 device licenses, 1 year of update entitlement each

**Multi-License Support:**
-   Multiple licenses can be activated on a single installation
-   Device packs are cumulative: 3 packs = 10 free + 30 licensed = 40 total devices
-   Pro license provides unlimited devices (overrides device packs)
-   Placeholder devices never count toward license limits

**Key Concepts:**
-   **Server Fingerprint:** Unique hash of hostname + MAC + machine-id, ties license to specific server
-   **Permanent Activation:** Once activated, works forever without internet (offline-friendly)
-   **Update Entitlement:** License includes 1 year of updates from purchase date; new versions built after expiry require renewal
-   **Backward Compatibility:** Supports both old single-license and new multi-license storage formats

**License Management:**
-   Settings page shows license status, tier, device count, active licenses, and fingerprint
-   "Upgrade to Pro" and "Add Device Pack (+10)" buttons for purchases
-   Manual activation via "Enter License Key" button (admin only)
-   Device limit enforced at creation time (single and batch)

**Stripe Integration (Licensing Server):**
-   `STRIPE_PRICE_ID` - Pro license price ID
-   `STRIPE_PRICE_ID_DEVICE_PACK` - Device pack price ID (default: price_1SjckoIEfpt7OIJOAL1swxmf)
-   Checkout flow supports product type via metadata

**Creating Licenses:**
Use `scripts/create-license.js` to generate licenses:
```bash
node scripts/create-license.js <fingerprint> [tier] [deviceLimit] [yearsOfUpdates]
```

**Files:**
-   `server/licensing.ts` - Licensing service (fingerprint, multi-license storage, validation, update checking)
-   `shared/schema.ts` - License database table
-   `license.json` - Local license storage file (supports array of licenses)

## Release Management System

The licensing server includes a complete release management system for distributing CoreBit updates:

**Admin Features:**
-   Web-based admin UI with tabbed interface (Licenses / Releases)
-   Upload releases with drag-and-drop support (.zip, .tar.gz, max 100MB)
-   Automatic SHA256 checksum calculation for integrity verification
-   Release channels (stable, beta) and pre-release marking
-   Changelog support and download count tracking
-   Delete releases from admin interface

**Update Check API:**
-   `/api/releases/check` - CoreBit installations check for updates
-   Entitlement-aware logic:
    -   Free tier: Always allowed to update
    -   Pro tier with valid entitlement: Allowed to update
    -   Pro tier with expired entitlement: Warning (update will revert to read-only mode)
-   Returns version info, changelog, download token, and SHA256 checksum

**Public Downloads (for Install Script):**
-   `/releases/latest.zip` - Public endpoint serving latest stable release
-   `/install.sh` - Quick install script for new installations
-   No authentication required - enables free tier distribution via website
-   Install command: `curl -fsSL https://licensing.corebit.ease.dk/install.sh | sudo bash`

**Authenticated Downloads:**
-   Download tokens use HMAC-SHA256 signatures with 1-hour expiry
-   Admin sessions can download directly without token
-   Token tied to specific version to prevent misuse

**CoreBit Client Integration:**
-   `server/licensing.ts` exports `checkForUpdates()` and `getLatestRelease()` functions
-   API endpoints: `/api/updates/check` and `/api/updates/latest`
-   Uses `LICENSING_SERVER_URL` environment variable for production configuration

**Files:**
-   `licensing-server/server.js` - Release API endpoints and file storage
-   `licensing-server/public/index.html` - Admin UI with releases tab
-   `licensing-server/releases/` - Directory for release files (per-version subdirectories)

## External Dependencies

-   **Database:** PostgreSQL (hosted on Neon for development, standard PostgreSQL for production).
-   **Mikrotik API Integration:** Utilizes `node-routeros` for communication.
-   **SNMP Integration:** Uses `net-snmp` for SNMP device probing and traffic monitoring.
-   **Frontend Libraries:** React, Wouter, TanStack Query, Tailwind CSS, Shadcn UI.