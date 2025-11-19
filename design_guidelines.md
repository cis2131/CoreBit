# Network Management Application - Design Guidelines

## Design Approach
**Reference-Based Approach**: Drawing inspiration from enterprise network topology tools (SolarWinds Network Topology Mapper, Cisco Prime Infrastructure) that prioritize functional clarity and technical precision over aesthetic flourish. This is a utility-focused, information-dense application where efficiency and learnability are paramount.

## Core Design Principles
1. **Technical Clarity**: Clean, unambiguous visual language for network topology
2. **Functional Hierarchy**: Tools and controls always accessible, never buried
3. **Status Transparency**: Immediate visual feedback for device states and connections
4. **Workspace Focus**: Canvas is the star - minimize UI chrome, maximize working area

---

## Typography
- **Primary Font**: Source Sans Pro (professional, technical readability)
- **Secondary Font**: Roboto (UI elements, buttons, labels)
- **Hierarchy**:
  - Device Labels: 14px medium weight
  - Toolbar/Panel Headers: 16px semi-bold
  - Property Details: 13px regular
  - Status Text: 12px regular

---

## Layout System
**Spacing Primitives**: Tailwind units of 2, 4, 8, and 16
- Component padding: `p-4`
- Section spacing: `gap-4` or `gap-8`
- Toolbar items: `space-x-2`
- Panel margins: `m-4`

**Application Structure**:
```
┌─────────────────────────────────────────┐
│  Top Toolbar (h-14)                     │
├────┬────────────────────────────────┬───┤
│ L  │                                │ R │
│ e  │    Canvas Workspace            │ i │
│ f  │    (auto-expanding grid)       │ g │
│ t  │                                │ h │
│    │                                │ t │
│ P  │                                │   │
│ a  │                                │ P │
│ n  │                                │ a │
│ e  │                                │ n │
│ l  │                                │ e │
│    │                                │ l │
└────┴────────────────────────────────┴───┘
```

---

## Color Palette (User-Provided)
- **Primary**: `#2C3E50` (network blue) - Headers, primary actions
- **Secondary**: `#34495E` (slate) - Panels, toolbars
- **Background**: `#ECF0F1` (light grey) - Application background
- **Canvas**: `#FFFFFF` (white) - Main workspace
- **Device**: `#3498DB` (bright blue) - Default device state
- **Connection**: `#95A5A6` (silver) - Network links
- **Alert**: `#E74C3C` (red) - Errors, critical states

**Status Indicators**:
- Online/Active: `#27AE60` (green)
- Warning: `#F39C12` (orange)
- Offline/Error: `#E74C3C` (red)
- Unknown: `#95A5A6` (grey)

---

## Component Library

### Top Toolbar
- Fixed height: `h-14`, Background: `#34495E`
- Left section: Logo/App name, Map selector dropdown
- Center: Device templates (draggable icons), Connection tool, Selection tool
- Right section: Search bar with icon, Settings, User menu

### Left Panel (Collapsible)
- Width: `w-64`, Background: `#ECF0F1`
- Device library with categorized sections (Mikrotik, Generic SNMP, Custom)
- Drag-and-drop device templates with icons
- Filter/search for device types

### Canvas Workspace
- Grid background (subtle dots or lines, `#E0E0E0`)
- Infinite scroll with auto-expansion when dragging near edges
- Pan with middle-mouse or space+drag
- Zoom controls in bottom-right corner
- Mini-map overlay (bottom-left) showing viewport position

### Right Panel (Contextual)
- Width: `w-80`, slides in when device selected
- Device properties: Name, IP, Type, Status badge
- SNMP/API data: Ports list, uptime, system info
- Connection details when link selected
- Edit/Delete actions at bottom

### Device Nodes
- Rounded rectangles with device icon on top
- Icon size: 48x48px, with status indicator dot (top-right)
- Label below icon (centered, max 2 lines with ellipsis)
- Hover: Subtle shadow, border highlight (`#3498DB`)
- Selected: Strong border (`#2C3E50`, 2px)

### Connection Lines
- SVG paths between device ports
- Default: `#95A5A6`, 2px stroke
- Hover: `#3498DB`, 3px stroke
- Selected: `#2C3E50`, 3px stroke
- Directional arrows for one-way connections

### Contextual Menus
- Right-click on device/connection
- White background, subtle shadow
- Options: Edit, Delete, Duplicate, Properties
- Dividers between action groups

---

## Icons
**Library**: Heroicons (outline for toolbar, solid for status)
- Network device representations (router, switch, server icons)
- Toolbar tools (cursor, connection line, search, settings)
- Status indicators (check-circle, exclamation, x-circle)

---

## Interaction Patterns
- **Drag-and-drop**: Smooth device placement with snap-to-grid option
- **Connections**: Click device port → drag → click target port
- **Canvas Pan**: Space+drag or middle-mouse
- **Zoom**: Scroll wheel or zoom controls (10-200% range)
- **Search**: Highlight matching devices, auto-pan to first result
- **Multi-select**: Ctrl+click or drag-select box

---

## Animations
**Minimal and Purposeful**:
- Panel slide transitions: 200ms ease
- Device hover states: 150ms ease
- Status indicator pulse (online): subtle 2s loop
- No scroll effects or unnecessary flourishes

---

## Images
**No hero images** - This is a functional application workspace. Visual elements are:
- Device type icons (SVG, monochrome with status color overlay)
- Logo/branding in top-left toolbar
- Empty state illustration when no devices on canvas (simple line drawing of network topology with "Drag devices to get started")