import { useState } from 'react';
import { Map, Device } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Search, Plus, Network, Moon, Sun, Link2, Settings, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { Link } from 'wouter';
import { DeviceStatusInfo } from '@/components/DeviceStatusInfo';

interface TopToolbarProps {
  maps: Map[];
  devices: Device[];
  currentMapId: string | null;
  onMapChange: (mapId: string) => void;
  onMapCreate: (name: string, description: string) => void;
  onMapEdit?: (map: Map) => void;
  onMapDelete?: (mapId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  connectionMode: boolean;
  onConnectionModeToggle: () => void;
  onAddDevice?: () => void;
  onDeviceStatusSelect?: (deviceId: string) => void;
}

export function TopToolbar({
  maps,
  devices,
  currentMapId,
  onMapChange,
  onMapCreate,
  onMapEdit,
  onMapDelete,
  searchQuery,
  onSearchChange,
  connectionMode,
  onConnectionModeToggle,
  onAddDevice,
  onDeviceStatusSelect,
}: TopToolbarProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newMapName, setNewMapName] = useState('');
  const [newMapDescription, setNewMapDescription] = useState('');
  const { theme, setTheme } = useTheme();
  
  const currentMap = maps.find(m => m.id === currentMapId);

  const handleCreateMap = () => {
    if (newMapName.trim()) {
      onMapCreate(newMapName, newMapDescription);
      setNewMapName('');
      setNewMapDescription('');
      setIsCreateDialogOpen(false);
    }
  };

  return (
    <div className="h-14 bg-secondary border-b border-border flex items-center justify-between px-4 gap-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Network className="h-6 w-6 text-primary" />
          <h1 className="text-base font-bold text-foreground hidden sm:block">Network Manager</h1>
        </div>

        <div className="flex items-center gap-2">
          <Select value={currentMapId || undefined} onValueChange={onMapChange}>
            <SelectTrigger className="w-48" data-testid="select-map">
              <SelectValue placeholder="Select a map" />
            </SelectTrigger>
            <SelectContent>
              {maps.map(map => (
                <SelectItem key={map.id} value={map.id} data-testid={`map-option-${map.id}`}>
                  {map.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {currentMap && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" data-testid="button-map-actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() => onMapEdit?.(currentMap)}
                  data-testid="button-edit-map"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Map
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onMapDelete?.(currentMap.id)}
                  className="text-destructive"
                  data-testid="button-delete-map"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Map
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="icon" variant="outline" data-testid="button-create-map">
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Map</DialogTitle>
                <DialogDescription>
                  Create a new network topology map to organize your devices
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="map-name">Map Name</Label>
                  <Input
                    id="map-name"
                    placeholder="e.g., Main Office Network"
                    value={newMapName}
                    onChange={(e) => setNewMapName(e.target.value)}
                    data-testid="input-map-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="map-description">Description (optional)</Label>
                  <Input
                    id="map-description"
                    placeholder="e.g., Primary office network topology"
                    value={newMapDescription}
                    onChange={(e) => setNewMapDescription(e.target.value)}
                    data-testid="input-map-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                  data-testid="button-cancel-create-map"
                >
                  Cancel
                </Button>
                <Button onClick={handleCreateMap} data-testid="button-confirm-create-map">
                  Create Map
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DeviceStatusInfo
          devices={devices}
          maps={maps}
          onDeviceSelect={onDeviceStatusSelect || (() => {})}
        />

        {onAddDevice && (
          <Button
            size="sm"
            onClick={onAddDevice}
            disabled={!currentMapId}
            data-testid="button-add-device"
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Device
          </Button>
        )}

        <Button
          variant={connectionMode ? 'default' : 'outline'}
          size="sm"
          onClick={onConnectionModeToggle}
          disabled={!currentMapId}
          data-testid="button-connection-mode"
          className="gap-2"
        >
          <Link2 className="h-4 w-4" />
          {connectionMode ? 'Cancel' : 'Connect'}
        </Button>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search devices..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 w-64"
            data-testid="input-search-devices"
          />
        </div>

        <Link href="/settings">
          <Button
            size="icon"
            variant="ghost"
            data-testid="button-settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </Link>

        <Button
          size="icon"
          variant="ghost"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          data-testid="button-theme-toggle"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>
    </div>
  );
}
