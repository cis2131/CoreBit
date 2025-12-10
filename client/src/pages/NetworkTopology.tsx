import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Map, Device, DevicePlacement, Connection, InsertDevice, InsertDevicePlacement, InsertConnection } from '@shared/schema';
import { NetworkCanvas } from '@/components/NetworkCanvas';
import { DevicePropertiesPanel } from '@/components/DevicePropertiesPanel';
import { ConnectionPropertiesPanel } from '@/components/ConnectionPropertiesPanel';
import { TopToolbar } from '@/components/TopToolbar';
import { AddDeviceDialog } from '@/components/AddDeviceDialog';
import { CreateConnectionDialog } from '@/components/CreateConnectionDialog';
import { DeviceListSidebar } from '@/components/DeviceListSidebar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useMapSync } from '@/hooks/useMapSync';
import { RefreshCw, Users } from 'lucide-react';

export default function NetworkTopology() {
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggingDeviceId, setDraggingDeviceId] = useState<string | null>(null);
  const [addDeviceDialogOpen, setAddDeviceDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editingMap, setEditingMap] = useState<Map | null>(null);
  const [connectionMode, setConnectionMode] = useState(false);
  const [connectionSource, setConnectionSource] = useState<string | null>(null);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [connectionTarget, setConnectionTarget] = useState<string | null>(null);
  const [initialSourcePort, setInitialSourcePort] = useState<string | undefined>(undefined);
  const [wasConnectionModeAutoStarted, setWasConnectionModeAutoStarted] = useState(false);
  const [editMapName, setEditMapName] = useState('');
  const [editMapDescription, setEditMapDescription] = useState('');
  const [editMapIsDefault, setEditMapIsDefault] = useState(false);
  const [focusDeviceId, setFocusDeviceId] = useState<string | null>(null);
  const [highlightedSidebarDeviceId, setHighlightedSidebarDeviceId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();
  const { canModify, user } = useAuth();
  
  // Handler for navigating to a device on a different map
  const handleNavigateToDevice = useCallback((deviceId: string, mapId: string) => {
    setCurrentMapId(mapId);
    setSelectedDeviceId(deviceId);
    setFocusDeviceId(deviceId);
    // Clear any highlighted sidebar device and cancel any pending timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    setHighlightedSidebarDeviceId(null);
  }, []);
  
  // Handler for highlighting an unplaced device in the sidebar
  const handleHighlightUnplacedDevice = useCallback((deviceId: string) => {
    // Cancel any pending highlight clear timeout
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    
    setHighlightedSidebarDeviceId(deviceId);
    // Open the device properties panel
    setSelectedDeviceId(deviceId);
    setSelectedPlacementId(null);
    
    // Clear the highlight after 3 seconds
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedSidebarDeviceId(null);
      highlightTimeoutRef.current = null;
    }, 3000);
  }, []);
  
  // Cleanup timeout on component unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  // Real-time map sync - detect changes made by other users
  const handleRemoteChange = useCallback(() => {
    // Show toast notification when remote changes are detected
    toast({
      title: 'Map updated',
      description: 'Another user made changes to this map.',
    });
  }, [toast]);

  const { hasRemoteChanges, clearRemoteChanges, isConnected: isSyncConnected } = useMapSync({
    mapId: currentMapId,
    userId: user?.id,
    onRemoteChange: handleRemoteChange,
  });

  // Handle refresh button click - refetch data and clear indicator
  const handleRefreshMap = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/placements', currentMapId] });
    queryClient.invalidateQueries({ queryKey: ['/api/connections', currentMapId] });
    clearRemoteChanges();
    toast({
      title: 'Map refreshed',
      description: 'Latest changes have been loaded.',
    });
  }, [currentMapId, clearRemoteChanges, toast]);

  const { data: maps = [] } = useQuery<Map[]>({
    queryKey: ['/api/maps'],
  });

  // Auto-load default map on startup
  const defaultMap = maps.find(m => m.isDefault);
  const shouldLoadDefaultMap = !currentMapId && defaultMap && maps.length > 0;
  
  useEffect(() => {
    if (shouldLoadDefaultMap) {
      setCurrentMapId(defaultMap.id);
    }
  }, [shouldLoadDefaultMap, defaultMap?.id]);

  // Global devices query
  const { data: allDevices = [] } = useQuery<Device[]>({
    queryKey: ['/api/devices'],
    refetchInterval: 10000, // Refetch every 10 seconds to show live device status updates
  });

  // Placements for current map
  const { data: placements = [] } = useQuery<DevicePlacement[]>({
    queryKey: currentMapId ? ['/api/placements', currentMapId] : [],
    enabled: !!currentMapId,
  });

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: currentMapId ? ['/api/connections', currentMapId] : [],
    enabled: !!currentMapId,
    refetchInterval: 10000, // Refetch every 10 seconds to show live traffic stats
  });

  // Map health summary - tracks which maps have offline devices
  const { data: mapHealthSummary = [] } = useQuery<{ mapId: string; hasOffline: boolean }[]>({
    queryKey: ['/api/map-health/summary'],
    refetchInterval: 10000, // Refetch every 10 seconds to match device status refresh
  });

  // Device notification summary - tracks which devices have global notifications enabled
  const { data: deviceNotificationMap = {} } = useQuery<Record<string, boolean>>({
    queryKey: ['/api/device-notification-summary'],
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Merge devices with their placements for the current map
  const devicesOnMap = placements.map(placement => {
    const device = allDevices.find(d => d.id === placement.deviceId);
    if (!device) return null;
    return {
      ...device,
      placementId: placement.id,
      position: placement.position,
      placementLinkedMapId: placement.linkedMapId,
    };
  }).filter(Boolean) as (Device & { placementId: string; position: { x: number; y: number }; placementLinkedMapId?: string | null })[];

  const createMapMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return await apiRequest('POST', '/api/maps', data);
    },
    onSuccess: (newMap: Map) => {
      queryClient.invalidateQueries({ queryKey: ['/api/maps'] });
      setCurrentMapId(newMap.id);
      toast({ title: 'Map created', description: `"${newMap.name}" has been created successfully.` });
    },
  });

  const updateMapMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ name: string; description: string; isDefault: boolean }> }) => {
      return await apiRequest('PATCH', `/api/maps/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/maps'] });
      setEditingMap(null);
      toast({ title: 'Map updated', description: 'Map has been updated successfully.' });
    },
  });

  const deleteMapMutation = useMutation({
    mutationFn: async (mapId: string) => {
      return await apiRequest('DELETE', `/api/maps/${mapId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/maps'] });
      setCurrentMapId(null);
      toast({ title: 'Map deleted', description: 'Map has been deleted.' });
    },
  });

  // Device mutations (global devices)
  const createDeviceMutation = useMutation({
    mutationFn: async (data: InsertDevice) => {
      return await apiRequest('POST', '/api/devices', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/devices'] });
      toast({ title: 'Device created', description: 'New device has been created.' });
    },
  });

  const updateDeviceMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertDevice> }) => {
      return await apiRequest('PATCH', `/api/devices/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/devices'] });
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      return await apiRequest('DELETE', `/api/devices/${deviceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/devices'] });
      // Invalidate all placements queries to update sidebar for all maps
      queryClient.invalidateQueries({ queryKey: ['/api/placements'] });
      queryClient.invalidateQueries({ queryKey: ['/api/connections', currentMapId] });
      setSelectedDeviceId(null);
      toast({ title: 'Device deleted', description: 'Device has been removed globally.' });
    },
  });

  // Placement mutations (devices on maps)
  const createPlacementMutation = useMutation({
    mutationFn: async (data: InsertDevicePlacement) => {
      return await apiRequest('POST', '/api/placements', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/placements', currentMapId] });
      queryClient.invalidateQueries({ queryKey: ['/api/connections', currentMapId] });
      toast({ title: 'Device added to map', description: 'Device has been placed on the map.' });
    },
  });

  const updatePlacementMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertDevicePlacement> }) => {
      return await apiRequest('PATCH', `/api/placements/${id}`, data);
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/placements', currentMapId] });
      const previousPlacements = queryClient.getQueryData(['/api/placements', currentMapId]);
      
      queryClient.setQueryData(['/api/placements', currentMapId], (old: DevicePlacement[] | undefined) => {
        if (!old) return old;
        return old.map(p => p.id === id ? { ...p, ...data } : p);
      });
      
      return { previousPlacements };
    },
    onError: (err, variables, context) => {
      if (context?.previousPlacements) {
        queryClient.setQueryData(['/api/placements', currentMapId], context.previousPlacements);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/placements', currentMapId] });
      queryClient.invalidateQueries({ queryKey: ['/api/connections', currentMapId] });
    },
  });

  const deletePlacementMutation = useMutation({
    mutationFn: async (placementId: string) => {
      return await apiRequest('DELETE', `/api/placements/${placementId}`);
    },
    onSuccess: () => {
      // Invalidate all placement queries to update sidebar
      queryClient.invalidateQueries({ queryKey: ['/api/placements'] });
      queryClient.invalidateQueries({ queryKey: ['/api/connections', currentMapId] });
      setSelectedPlacementId(null);
      setSelectedDeviceId(null);
      toast({ title: 'Device removed from map', description: 'Device has been removed from this map.' });
    },
  });

  const createConnectionMutation = useMutation({
    mutationFn: async (data: InsertConnection) => {
      return await apiRequest('POST', '/api/connections', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/connections', currentMapId] });
      toast({ title: 'Connection created', description: 'Devices have been connected successfully.' });
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      return await apiRequest('DELETE', `/api/connections/${connectionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/connections', currentMapId] });
      setSelectedConnectionId(null);
      toast({ title: 'Connection deleted', description: 'Connection has been removed.' });
    },
  });

  const handleMapCreate = (name: string, description: string) => {
    createMapMutation.mutate({ name, description });
  };

  const handleMapEdit = (map: Map) => {
    setEditingMap(map);
    setEditMapName(map.name);
    setEditMapDescription(map.description || '');
    setEditMapIsDefault(map.isDefault || false);
  };

  const handleMapUpdate = (mapId: string, name: string, description: string, isDefault: boolean) => {
    updateMapMutation.mutate({ id: mapId, data: { name, description, isDefault } });
  };

  const handleMapDelete = (mapId: string) => {
    if (confirm('Are you sure you want to delete this map? All device placements and connections on this map will be removed.')) {
      deleteMapMutation.mutate(mapId);
    }
  };

  const handleAddDevice = () => {
    if (!currentMapId) {
      toast({ title: 'No map selected', description: 'Please select or create a map first.', variant: 'destructive' });
      return;
    }
    setEditingDevice(null);
    setAddDeviceDialogOpen(true);
  };

  const handleDeviceSubmit = async (deviceData: { 
    name: string; 
    type: string; 
    ipAddress: string; 
    position: { x: number; y: number };
    credentialProfileId?: string;
    customCredentials?: any;
  }) => {
    if (!currentMapId) return;

    if (editingDevice) {
      // Update existing device (global)
      updateDeviceMutation.mutate({
        id: editingDevice.id,
        data: {
          name: deviceData.name,
          type: deviceData.type,
          ipAddress: deviceData.ipAddress || undefined,
          credentialProfileId: deviceData.credentialProfileId || undefined,
          customCredentials: deviceData.customCredentials || undefined,
        },
      });
      setEditingDevice(null);
    } else {
      // Create new device and place on map
      const newDevice = await createDeviceMutation.mutateAsync({
        name: deviceData.name,
        type: deviceData.type,
        ipAddress: deviceData.ipAddress || undefined,
        credentialProfileId: deviceData.credentialProfileId || undefined,
        customCredentials: deviceData.customCredentials || undefined,
      });
      
      // Create placement for the new device
      createPlacementMutation.mutate({
        deviceId: newDevice.id,
        mapId: currentMapId,
        position: deviceData.position,
      });
    }
  };

  const handleDeviceDragFromSidebar = (deviceId: string, position: { x: number; y: number }) => {
    if (!currentMapId) {
      toast({ title: 'No map selected', description: 'Please select a map first.', variant: 'destructive' });
      return;
    }
    
    // Check if device is already on this map
    const existingPlacement = placements.find(p => p.deviceId === deviceId);
    if (existingPlacement) {
      toast({ title: 'Device already on map', description: 'This device is already placed on this map.', variant: 'destructive' });
      return;
    }

    createPlacementMutation.mutate({
      deviceId,
      mapId: currentMapId,
      position,
    });
  };

  const handleDeviceMove = (deviceId: string, position: { x: number; y: number }) => {
    const deviceOnMap = devicesOnMap.find(d => d.id === deviceId);
    if (!deviceOnMap) return;

    updatePlacementMutation.mutate({
      id: deviceOnMap.placementId,
      data: { position },
    });
  };

  const handleDeviceDelete = (deviceId: string) => {
    const deviceOnMap = devicesOnMap.find(d => d.id === deviceId);
    if (!deviceOnMap) return;
    
    // Delete placement (removes device from this map only)
    deletePlacementMutation.mutate(deviceOnMap.placementId);
  };

  const handleDeviceEdit = (device: Device) => {
    setEditingDevice(device);
    setAddDeviceDialogOpen(true);
  };

  const handleConnectionModeToggle = () => {
    setConnectionMode(!connectionMode);
    setConnectionSource(null);
    setConnectionTarget(null);
    setInitialSourcePort(undefined);
    setWasConnectionModeAutoStarted(false);
  };

  const handleStartConnectionFromPort = (deviceId: string, portName: string) => {
    // Set connection mode and prefill source device and port
    setConnectionMode(true);
    setConnectionSource(deviceId);
    setInitialSourcePort(portName);
    setWasConnectionModeAutoStarted(true);
    toast({ 
      title: 'Connection started', 
      description: `Source: ${portName}. Click another device to complete the connection.` 
    });
  };

  const handleConnectionDialogClose = (open: boolean) => {
    setConnectionDialogOpen(open);
    
    // If dialog is being closed and connection mode was auto-started, reset everything
    if (!open && wasConnectionModeAutoStarted) {
      setConnectionMode(false);
      setConnectionSource(null);
      setConnectionTarget(null);
      setInitialSourcePort(undefined);
      setWasConnectionModeAutoStarted(false);
    }
  };

  const handleDeviceClickForConnection = (deviceId: string) => {
    if (!connectionMode) {
      setSelectedDeviceId(deviceId);
      return;
    }

    if (!connectionSource) {
      setConnectionSource(deviceId);
      toast({ title: 'Source selected', description: 'Click another device to complete the connection.' });
    } else if (connectionSource !== deviceId) {
      setConnectionTarget(deviceId);
      setConnectionDialogOpen(true);
    } else {
      toast({ title: 'Same device', description: 'Please select a different device.', variant: 'destructive' });
    }
  };

  const handleConnectionCreate = (sourcePort: string, targetPort: string) => {
    if (!currentMapId || !connectionSource || !connectionTarget) return;

    createConnectionMutation.mutate({
      mapId: currentMapId,
      sourceDeviceId: connectionSource,
      targetDeviceId: connectionTarget,
      sourcePort,
      targetPort,
      connectionType: 'ethernet',
    });

    setConnectionSource(null);
    setConnectionTarget(null);
    setConnectionMode(false);
    setInitialSourcePort(undefined);
    setWasConnectionModeAutoStarted(false);
  };

  const handleConnectionDelete = () => {
    if (selectedConnectionId) {
      deleteConnectionMutation.mutate(selectedConnectionId);
    }
  };

  const handleDeviceStatusSelect = async (deviceId: string) => {
    // Find first map that contains this device by checking each map's placements
    for (const map of maps) {
      try {
        const mapPlacements = await apiRequest('GET', `/api/placements/${map.id}`);
        const placement = (mapPlacements as DevicePlacement[]).find(p => p.deviceId === deviceId);
        if (placement) {
          setCurrentMapId(map.id);
          setSelectedDeviceId(deviceId);
          setSelectedPlacementId(placement.id);
          // Set focusDeviceId to trigger canvas centering on this device
          setFocusDeviceId(deviceId);
          return;
        }
      } catch (error) {
        console.error(`Failed to check placements for map ${map.id}:`, error);
      }
    }

    toast({ title: 'Device not on any map', description: 'This device is not placed on any map yet.', variant: 'destructive' });
  };

  // Look for selected device on map first, then fall back to all devices (for unplaced devices)
  const selectedDevice = selectedDeviceId 
    ? (devicesOnMap.find(d => d.id === selectedDeviceId) || allDevices.find(d => d.id === selectedDeviceId))
    : null;
  const selectedConnection = selectedConnectionId ? connections.find(c => c.id === selectedConnectionId) : null;
  const selectedConnectionSourceDevice = selectedConnection ? devicesOnMap.find(d => d.id === selectedConnection.sourceDeviceId) : null;
  const selectedConnectionTargetDevice = selectedConnection ? devicesOnMap.find(d => d.id === selectedConnection.targetDeviceId) : null;
  const sourceDevice = connectionSource ? devicesOnMap.find(d => d.id === connectionSource) : null;
  const targetDevice = connectionTarget ? devicesOnMap.find(d => d.id === connectionTarget) : null;

  if (maps.length === 0 && !currentMapId) {
    return (
      <div className="h-screen flex flex-col">
        <TopToolbar
          maps={maps}
          devices={allDevices}
          currentMapId={currentMapId}
          onMapChange={setCurrentMapId}
          onMapCreate={handleMapCreate}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          connectionMode={connectionMode}
          onConnectionModeToggle={handleConnectionModeToggle}
          onAddDevice={handleAddDevice}
          onDeviceStatusSelect={handleDeviceStatusSelect}
          onNavigateToDevice={handleNavigateToDevice}
          onHighlightUnplacedDevice={handleHighlightUnplacedDevice}
        />
        <div className="flex-1 flex items-center justify-center bg-background">
          <div className="text-center space-y-4 max-w-md p-8">
            <h2 className="text-2xl font-bold text-foreground">Welcome to CoreBit</h2>
            <p className="text-muted-foreground">
              Get started by creating your first network topology map
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <TopToolbar
        maps={maps}
        devices={allDevices}
        currentMapId={currentMapId}
        onMapChange={setCurrentMapId}
        onMapCreate={handleMapCreate}
        onMapEdit={handleMapEdit}
        onMapDelete={handleMapDelete}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        connectionMode={connectionMode}
        onConnectionModeToggle={handleConnectionModeToggle}
        onAddDevice={handleAddDevice}
        onDeviceStatusSelect={handleDeviceStatusSelect}
        onNavigateToDevice={handleNavigateToDevice}
        onHighlightUnplacedDevice={handleHighlightUnplacedDevice}
      />

      {/* Remote changes banner */}
      {hasRemoteChanges && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800 px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
            <Users className="h-4 w-4" />
            <span>Another user made changes to this map</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefreshMap}
            className="bg-white dark:bg-gray-800"
            data-testid="button-refresh-map"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Map
          </Button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <DeviceListSidebar
          devices={allDevices}
          placedDeviceIds={placements.map(p => p.deviceId)}
          onDeviceDragStart={canModify ? setDraggingDeviceId : undefined}
          onDeviceDragEnd={() => setDraggingDeviceId(null)}
          onEditDevice={handleDeviceEdit}
          onDeviceClick={(deviceId) => {
            // Check if device is placed on current map
            const placedDevice = devicesOnMap.find(d => d.id === deviceId);
            if (placedDevice) {
              setSelectedDeviceId(deviceId);
              setSelectedPlacementId(placedDevice.placementId);
            } else {
              // Device not on current map - still open properties panel
              setSelectedDeviceId(deviceId);
              setSelectedPlacementId(null);
            }
          }}
          canModify={canModify}
          highlightedDeviceId={highlightedSidebarDeviceId}
        />

        <div className="flex-1">
          {currentMapId ? (
            <NetworkCanvas
              mapId={currentMapId}
              devices={devicesOnMap}
              connections={connections}
              selectedDeviceId={connectionMode ? connectionSource : selectedDeviceId}
              selectedConnectionId={selectedConnectionId}
              onDeviceClick={handleDeviceClickForConnection}
              onDeviceMove={handleDeviceMove}
              onConnectionClick={setSelectedConnectionId}
              onCanvasClick={() => {
                setSelectedDeviceId(null);
                setSelectedConnectionId(null);
                if (connectionMode) {
                  setConnectionSource(null);
                  setConnectionTarget(null);
                }
              }}
              searchQuery={searchQuery}
              draggingDeviceId={draggingDeviceId}
              onDeviceDropFromSidebar={handleDeviceDragFromSidebar}
              onDraggingComplete={() => setDraggingDeviceId(null)}
              focusDeviceId={focusDeviceId}
              onFocusComplete={() => setFocusDeviceId(null)}
              onMapLinkClick={(mapId) => {
                setCurrentMapId(mapId);
                setSelectedDeviceId(null);
                setSelectedConnectionId(null);
              }}
              mapHealthSummary={mapHealthSummary}
              deviceNotificationMap={deviceNotificationMap}
            />
          ) : (
            <div className="h-full flex items-center justify-center bg-white dark:bg-gray-950">
              <p className="text-muted-foreground">Select a map to get started</p>
            </div>
          )}
        </div>

        {selectedDevice && !connectionMode && (
          <DevicePropertiesPanel
            device={selectedDevice}
            connections={connections}
            allDevices={allDevices}
            onClose={() => setSelectedDeviceId(null)}
            onDelete={handleDeviceDelete}
            onEdit={handleDeviceEdit}
            onNavigateToDevice={(deviceId) => {
              const device = devicesOnMap.find(d => d.id === deviceId);
              if (device) {
                setSelectedDeviceId(deviceId);
                setSelectedPlacementId(device.placementId);
              }
            }}
            onNavigateToMap={(mapId) => {
              setCurrentMapId(mapId);
              setSelectedDeviceId(null);
              setSelectedConnectionId(null);
            }}
            onStartConnectionFromPort={handleStartConnectionFromPort}
            canModify={canModify}
            currentMapId={currentMapId}
          />
        )}

        {selectedConnection && selectedConnectionSourceDevice && selectedConnectionTargetDevice && !connectionMode && (
          <ConnectionPropertiesPanel
            connection={selectedConnection}
            sourceDevice={selectedConnectionSourceDevice}
            targetDevice={selectedConnectionTargetDevice}
            onClose={() => setSelectedConnectionId(null)}
            onDelete={handleConnectionDelete}
            canModify={canModify}
          />
        )}
      </div>

      <AddDeviceDialog
        open={addDeviceDialogOpen}
        onClose={() => {
          setAddDeviceDialogOpen(false);
          setEditingDevice(null);
        }}
        onSubmit={handleDeviceSubmit}
        onDelete={(deviceId) => deleteDeviceMutation.mutate(deviceId)}
        initialPosition={{ x: 100, y: 100 }}
        initialType={editingDevice?.type || ''}
        editDevice={editingDevice}
      />

      <Dialog open={!!editingMap} onOpenChange={(open) => !open && setEditingMap(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Map</DialogTitle>
            <DialogDescription>
              Update the name, description, and settings of this network topology map
            </DialogDescription>
          </DialogHeader>
          {editingMap && (
            <form onSubmit={(e) => {
              e.preventDefault();
              handleMapUpdate(
                editingMap.id,
                editMapName,
                editMapDescription,
                editMapIsDefault
              );
            }}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-map-name">Map Name</Label>
                  <Input
                    id="edit-map-name"
                    value={editMapName}
                    onChange={(e) => setEditMapName(e.target.value)}
                    required
                    data-testid="input-edit-map-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-map-description">Description (optional)</Label>
                  <Input
                    id="edit-map-description"
                    value={editMapDescription}
                    onChange={(e) => setEditMapDescription(e.target.value)}
                    data-testid="input-edit-map-description"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-map-default"
                    checked={editMapIsDefault}
                    onChange={(e) => setEditMapIsDefault(e.target.checked)}
                    data-testid="checkbox-set-default-map"
                  />
                  <Label htmlFor="edit-map-default" className="cursor-pointer text-sm">
                    Set as default map (loads on startup)
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingMap(null)}
                  data-testid="button-cancel-edit-map"
                >
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-confirm-edit-map">
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <CreateConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={handleConnectionDialogClose}
        sourceDevice={sourceDevice || null}
        targetDevice={targetDevice || null}
        onConfirm={handleConnectionCreate}
        initialSourcePort={initialSourcePort}
        connections={connections}
        allDevices={allDevices}
      />
    </div>
  );
}
