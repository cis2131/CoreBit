# CoreBit - Network Topology Manager

## Overview

CoreBit is a modern, web-based network management application inspired by Mikrotik's "The Dude." It provides an interactive canvas for mapping network topology, managing Mikrotik and generic SNMP/Prometheus devices, and visualizing real-time device status. The project aims to offer a professional-grade tool for network administrators to efficiently monitor, map, and manage their network infrastructure, featuring drag-and-drop device placement, multi-map support, and automated device probing.

## User Preferences

I prefer clear, concise explanations and direct answers. For coding, I favor an iterative development approach with frequent, small commits. Please ask for confirmation before implementing major architectural changes or significant feature modifications. I value detailed explanations when new concepts or complex solutions are introduced.

## System Architecture

The application employs a client-server architecture.

**Frontend:**
-   **Technology:** React with TypeScript, Wouter, TanStack Query.
-   **Styling:** Tailwind CSS with Shadcn UI for a modern aesthetic, using Source Sans Pro and Roboto fonts.
-   **UI/UX:** Features a fixed toolbar, collapsible panels, an infinite canvas with pan/zoom, snap-to-grid, and status indicators (Green: online, Yellow: warning, Red: offline, Gray: unknown). Includes dark/light theme, empty states, and loading indicators.

**Backend:**
-   **Technology:** Node.js with Express.
-   **Database:** PostgreSQL (via Neon) managed with Drizzle ORM.
-   **Core Logic:** Implements mock Mikrotik API and SNMP probing for device discovery and data collection.

**System Design Choices:**
-   **Global Device Model:** Devices are stored globally and can be placed on multiple maps.
-   **Parallel Probing Service:** High-performance system for real-time status updates (400+ devices/30s) with timeout protection and optimized link speed detection.
-   **Device Types:** Supports Mikrotik Router/Switch (Mikrotik API), Generic SNMP Device (SNMP), Prometheus Device (node_exporter), Ping Only Device (ICMP), and Server/Access Point.
-   **Offline Threshold:** Configurable N consecutive failed probes before a device is marked offline.
-   **Network Scanner:** Automated device discovery on IP ranges with multi-credential support, auto-detection, and bulk creation.
-   **Traffic Monitoring:** Real-time traffic monitoring via SNMP (Mikrotik, generic SNMP) and Prometheus/node_exporter (Linux servers).
-   **Prometheus Metrics Historical Monitoring:** Stores and visualizes historical data for custom Prometheus metrics with interactive charts, time range selection, and auto-refresh.
-   **Backup & Restore:** Manual and scheduled backups with configurable retention, supporting full application data.
-   **On-Duty Notification System:** Shift-based (Day/Night) notification system assigning users to shifts, with device-specific on-duty flags.
-   **Alarm Muting System:** Allows temporary muting of alarms globally or per-user with configurable durations.
-   **Dynamic Connections (Proxmox VM Migration):** Connections can automatically update based on VM migrations between Proxmox cluster nodes.

**Technical Implementations:**
-   TypeScript strict mode, React Query for data handling, Drizzle ORM for type-safe queries, Zod for validation.

## External Dependencies

-   **Database:** PostgreSQL.
-   **Mikrotik API Integration:** `node-routeros`.
-   **SNMP Integration:** `net-snmp`.
-   **Frontend Libraries:** React, Wouter, TanStack Query, Tailwind CSS, Shadcn UI.