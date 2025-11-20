import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Map, Device, Connection, InsertDevice, InsertConnection } from '@shared/schema';
import { NetworkCanvas } from '@/components/NetworkCanvas';
import { DeviceLibrary } from '@/components/DeviceLibrary';
import { DevicePropertiesPanel } from '@/components/DevicePropertiesPanel';
import { ConnectionPropertiesPanel } from '@/components/ConnectionPropertiesPanel';
import { TopToolbar } from '@/components/TopToolbar';
import { AddDeviceDialog } from '@/components/AddDeviceDialog';
import { CreateConnectionDialog } from '@/components/CreateConnectionDialog';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export default function NetworkTopology() {
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggingDeviceType, setDraggingDeviceType] = useState<string | null>(null);
  const [addDeviceDialogOpen, setAddDeviceDialogOpen] = useState(false);
  const [pendingDevicePosition, setPendingDevicePosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [pendingDeviceType, setPendingDeviceType] = useState('');
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [connectionMode, setConnectionMode] = useState(false);
  const [connectionSource, setConnectionSource] = useState<string | null>(null);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [connectionTarget, setConnectionTarget] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: maps = [] } = useQuery<Map[]>({
    queryKey: ['/api/maps'],
  });

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: [`/api/devices?mapId=${currentMapId}`],
    enabled: !!currentMapId,
    refetchInterval: 10000, // Refetch every 10 seconds to show live device status updates
  });

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: [`/api/connections?mapId=${currentMapId}`],
    enabled: !!currentMapId,
  });

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

  const createDeviceMutation = useMutation({
    mutationFn: async (data: InsertDevice) => {
      return await apiRequest('POST', '/api/devices', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/devices?mapId=${currentMapId}`] });
      toast({ title: 'Device added', description: 'Device has been added to the map.' });
    },
  });

  const updateDeviceMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertDevice> }) => {
      return await apiRequest('PATCH', `/api/devices/${id}`, data);
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: [`/api/devices?mapId=${currentMapId}`] });
      
      // Snapshot the previous value
      const previousDevices = queryClient.getQueryData([`/api/devices?mapId=${currentMapId}`]);
      
      // Optimistically update to the new value
      queryClient.setQueryData([`/api/devices?mapId=${currentMapId}`], (old: Device[] | undefined) => {
        if (!old) return old;
        return old.map(device => 
          device.id === id ? { ...device, ...data } : device
        );
      });
      
      return { previousDevices };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousDevices) {
        queryClient.setQueryData([`/api/devices?mapId=${currentMapId}`], context.previousDevices);
      }
    },
    onSettled: () => {
      // Refetch after error or success to ensure we're in sync
      queryClient.invalidateQueries({ queryKey: [`/api/devices?mapId=${currentMapId}`] });
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      return await apiRequest('DELETE', `/api/devices/${deviceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/devices?mapId=${currentMapId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/connections?mapId=${currentMapId}`] });
      setSelectedDeviceId(null);
      toast({ title: 'Device deleted', description: 'Device has been removed from the map.' });
    },
  });

  const createConnectionMutation = useMutation({
    mutationFn: async (data: InsertConnection) => {
      return await apiRequest('POST', '/api/connections', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/connections?mapId=${currentMapId}`] });
      toast({ title: 'Connection created', description: 'Devices have been connected successfully.' });
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      return await apiRequest('DELETE', `/api/connections/${connectionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/connections?mapId=${currentMapId}`] });
      setSelectedConnectionId(null);
      toast({ title: 'Connection deleted', description: 'Connection has been removed.' });
    },
  });

  const handleMapCreate = (name: string, description: string) => {
    createMapMutation.mutate({ name, description });
  };

  const handleDeviceAdd = (position: { x: number; y: number }, type: string) => {
    if (!currentMapId) {
      toast({ title: 'No map selected', description: 'Please select or create a map first.', variant: 'destructive' });
      return;
    }
    setPendingDevicePosition(position);
    setPendingDeviceType(type);
    setAddDeviceDialogOpen(true);
  };

  const handleDeviceSubmit = (deviceData: { 
    name: string; 
    type: string; 
    ipAddress: string; 
    position: { x: number; y: number };
    credentialProfileId?: string;
    customCredentials?: any;
  }) => {
    if (!currentMapId) return;

    if (editingDevice) {
      updateDeviceMutation.mutate({
        id: editingDevice.id,
        data: {
          name: deviceData.name,
          type: deviceData.type,
          ipAddress: deviceData.ipAddress || undefined,
          mapId: currentMapId,
          position: deviceData.position,
          status: editingDevice.status,
          credentialProfileId: deviceData.credentialProfileId || undefined,
          customCredentials: deviceData.customCredentials || undefined,
        },
      });
      setEditingDevice(null);
    } else {
      createDeviceMutation.mutate({
        mapId: currentMapId,
        name: deviceData.name,
        type: deviceData.type,
        ipAddress: deviceData.ipAddress || undefined,
        position: deviceData.position,
        status: 'unknown',
        credentialProfileId: deviceData.credentialProfileId || undefined,
        customCredentials: deviceData.customCredentials || undefined,
      });
    }
  };

  const handleDeviceMove = (deviceId: string, position: { x: number; y: number }) => {
    if (!currentMapId) return;
    const device = devices.find(d => d.id === deviceId);
    if (!device) return;

    updateDeviceMutation.mutate({
      id: deviceId,
      data: {
        mapId: currentMapId,
        name: device.name,
        type: device.type,
        position,
        status: device.status,
      },
    });
  };

  const handleDeviceDelete = (deviceId: string) => {
    deleteDeviceMutation.mutate(deviceId);
  };

  const handleDeviceEdit = (device: Device) => {
    setEditingDevice(device);
    setPendingDeviceType(device.type);
    setAddDeviceDialogOpen(true);
  };

  const handleConnectionModeToggle = () => {
    setConnectionMode(!connectionMode);
    setConnectionSource(null);
    setConnectionTarget(null);
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
  };

  const handleConnectionDelete = () => {
    if (selectedConnectionId) {
      deleteConnectionMutation.mutate(selectedConnectionId);
    }
  };

  const selectedDevice = selectedDeviceId ? devices.find(d => d.id === selectedDeviceId) : null;
  const selectedConnection = selectedConnectionId ? connections.find(c => c.id === selectedConnectionId) : null;
  const selectedConnectionSourceDevice = selectedConnection ? devices.find(d => d.id === selectedConnection.sourceDeviceId) : null;
  const selectedConnectionTargetDevice = selectedConnection ? devices.find(d => d.id === selectedConnection.targetDeviceId) : null;
  const sourceDevice = connectionSource ? devices.find(d => d.id === connectionSource) : null;
  const targetDevice = connectionTarget ? devices.find(d => d.id === connectionTarget) : null;

  if (maps.length === 0 && !currentMapId) {
    return (
      <div className="h-screen flex flex-col">
        <TopToolbar
          maps={maps}
          currentMapId={currentMapId}
          onMapChange={setCurrentMapId}
          onMapCreate={handleMapCreate}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          connectionMode={connectionMode}
          onConnectionModeToggle={handleConnectionModeToggle}
        />
        <div className="flex-1 flex items-center justify-center bg-background">
          <div className="text-center space-y-4 max-w-md p-8">
            <h2 className="text-2xl font-bold text-foreground">Welcome to Network Manager</h2>
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
        currentMapId={currentMapId}
        onMapChange={setCurrentMapId}
        onMapCreate={handleMapCreate}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        connectionMode={connectionMode}
        onConnectionModeToggle={handleConnectionModeToggle}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 flex-shrink-0">
          <DeviceLibrary onDeviceDragStart={setDraggingDeviceType} />
        </div>

        <div className="flex-1">
          {currentMapId ? (
            <NetworkCanvas
              devices={devices}
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
              onDeviceAdd={handleDeviceAdd}
              draggingDeviceType={draggingDeviceType}
              onDraggingComplete={() => setDraggingDeviceType(null)}
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
            onClose={() => setSelectedDeviceId(null)}
            onDelete={handleDeviceDelete}
            onEdit={handleDeviceEdit}
          />
        )}

        {selectedConnection && selectedConnectionSourceDevice && selectedConnectionTargetDevice && !connectionMode && (
          <ConnectionPropertiesPanel
            connection={selectedConnection}
            sourceDevice={selectedConnectionSourceDevice}
            targetDevice={selectedConnectionTargetDevice}
            onClose={() => setSelectedConnectionId(null)}
            onDelete={handleConnectionDelete}
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
        initialPosition={pendingDevicePosition}
        initialType={pendingDeviceType}
        editDevice={editingDevice}
      />

      <CreateConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
        sourceDevice={sourceDevice || null}
        targetDevice={targetDevice || null}
        onConfirm={handleConnectionCreate}
      />
    </div>
  );
}
