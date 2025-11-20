import { useState } from 'react';
import { Map } from '@shared/schema';
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
import { Label } from '@/components/ui/label';
import { Search, Plus, Network, Moon, Sun, Link2, Settings } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { Link } from 'wouter';
import { CompactDevicePalette } from './CompactDevicePalette';

interface TopToolbarProps {
  maps: Map[];
  currentMapId: string | null;
  onMapChange: (mapId: string) => void;
  onMapCreate: (name: string, description: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  connectionMode: boolean;
  onConnectionModeToggle: () => void;
  onDeviceDragStart?: (deviceType: string) => void;
}

export function TopToolbar({
  maps,
  currentMapId,
  onMapChange,
  onMapCreate,
  searchQuery,
  onSearchChange,
  connectionMode,
  onConnectionModeToggle,
  onDeviceDragStart,
}: TopToolbarProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newMapName, setNewMapName] = useState('');
  const [newMapDescription, setNewMapDescription] = useState('');
  const { theme, setTheme } = useTheme();

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

        {onDeviceDragStart && (
          <CompactDevicePalette
            onDeviceDragStart={onDeviceDragStart}
            disabled={!currentMapId}
          />
        )}

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
