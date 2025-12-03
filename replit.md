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
    -   **Ping Only Device:** For devices without SNMP/API support - monitored via 2 concurrent ICMP pings for reliability
    -   **Server/Access Point:** SNMP-based monitoring with appropriate icons
-   **Offline Threshold:** All device types respect configurable offline threshold - devices only go offline after N consecutive failed probes (default 3), preventing notification spam from transient failures.
-   **Network Scanner:** Automated discovery of devices on IP ranges (CIDR/Range support), multi-credential support, auto-detection of device types, scan profile saving, and bulk device creation.
-   **Traffic Monitoring:** Real-time traffic monitoring on connections using SNMP, requiring SNMP credentials. Optimizes polling with stored SNMP interface indexes for faster data retrieval and calculates traffic rates and utilization.
-   **Backup & Restore:** Provides manual and scheduled backups with configurable retention policies. Supports downloading, uploading, and restoring full application data, including devices, maps, connections, credentials, and settings. Backup files are JSON-formatted and stored locally.
-   **On-Duty Notification System:** Simplified shift-based notification system with direct user-to-shift assignments:
    -   Two shifts: Day and Night, with configurable start/end times and timezone
    -   Users are directly assigned to shifts (no teams) via Settings
    -   Devices have a `useOnDuty` boolean flag - when enabled, alerts go to on-duty operators in addition to global notifications
    -   Global notifications and on-duty notifications can be active simultaneously for redundancy
    -   On-duty checkbox appears in Device Properties Panel under Notifications section

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

## External Dependencies

-   **Database:** PostgreSQL (hosted on Neon for development, standard PostgreSQL for production).
-   **Mikrotik API Integration:** Utilizes `node-routeros` for communication.
-   **SNMP Integration:** Uses `net-snmp` for SNMP device probing and traffic monitoring.
-   **Frontend Libraries:** React, Wouter, TanStack Query, Tailwind CSS, Shadcn UI.