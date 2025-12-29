## CoreBit features
# Supported polling protocols:
 - Mikrotik API  (Device info, CPU, MEM, uptime, Firmware version,  Interfaces, Ip adresses)
 - Genreric SNMP (Device info, CPU, MEM, uptime, Interfaces, traffic)
 - Prometheus Node Exporter "Recommended for servers", (Device info, CPU, MEM, uptime, Interfaces, traffic, ip addresses)
 - Proxmox API (Includes vm location in clustered setup).
 - Generic ping.

# Supported Notification providers:
 - Telegram (Bot)
 - Pushover
 - Generic webhook (http get/post) with template.

# IP address management (IPAM):
If Mikrotik API, or Node Exporter is used, CoreBit will collect ip addresses on all interfaces and vlans, and update it in IPAM automatically. That way you always know which ip address is used where, and whats available. It even saves the interface name ip address is configured on.

# Device monitoring: 
Device monitoring works by prioritizing polling (API, Prometehus, Snmp), and if that fails it pings the device.
Devices that fails to be probed but responds to ping, will be marked as stale. Alarm will only be sent if both tests are negative.
Notifications can be set at 2 levels, and has to be enabled on every device added.
A General notification can be set on all devices, and can be used for simple setups, or a general alarm channel.
The more advanced way is to create an On Duty plan in settings, and enable that on the device. This way alarms for the device will only be sent to operator on duty. Both methods can be used at the same time, For example, alarms could go to a general muted channel, for full overview, while relevant alarms only notifies operator on duty.


# Global search:
Easy find any device in your maps, CoreBit will locate and point it out for you.

# Linked maps:
A device can link to another map of devices, if any device on the submap is in down state, the link will glow red. 

# System Backup:
CoreBit backups can be made from settings, and an automatic schedule can also be configured.
It is recommended to include the backups folder under CoreBit installation in your regular backup systems.

# User Management: 
Corebit supports multiple users, with 3 levels of access:
 - Administrator (Full access)
 - SuperUser (No access to settings menu)
 - Viewer (Read only access)
Please note that all users works in tha same environment, so changes are applied to all users.


For security reasons, always make sure to only give CoreBit Read only access to devices.
