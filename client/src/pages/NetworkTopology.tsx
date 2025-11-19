import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Map, Device, Connection, InsertDevice } from '@shared/schema';
import { NetworkCanvas } from '@/components/NetworkCanvas';
import { DeviceLibrary } from '@/components/DeviceLibrary';
import { DevicePropertiesPanel } from '@/components/DevicePropertiesPanel';
import { TopToolbar } from '@/components/TopToolbar';
import { AddDeviceDialog } from '@/components/AddDeviceDialog';
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
  const { toast } = useToast();

  const { data: maps = [] } = useQuery<Map[]>({
    queryKey: ['/api/maps'],
  });

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: [`/api/devices?mapId=${currentMapId}`],
    enabled: !!currentMapId,
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
    onSuccess: () => {
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

  const handleDeviceSubmit = (deviceData: { name: string; type: string; ipAddress: string; position: { x: number; y: number } }) => {
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

  const selectedDevice = selectedDeviceId ? devices.find(d => d.id === selectedDeviceId) : null;

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
              selectedDeviceId={selectedDeviceId}
              selectedConnectionId={selectedConnectionId}
              onDeviceClick={setSelectedDeviceId}
              onDeviceMove={handleDeviceMove}
              onConnectionClick={setSelectedConnectionId}
              onCanvasClick={() => {
                setSelectedDeviceId(null);
                setSelectedConnectionId(null);
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

        {selectedDevice && (
          <DevicePropertiesPanel
            device={selectedDevice}
            onClose={() => setSelectedDeviceId(null)}
            onDelete={handleDeviceDelete}
            onEdit={handleDeviceEdit}
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
    </div>
  );
}
