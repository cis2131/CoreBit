import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth, type User } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Edit, ArrowLeft, Bell, BellOff, Download, Upload, Clock, HardDrive, RefreshCw, Users, Crown, Shield, Eye, Loader2, UserCog, Calendar, Sun, Moon, Webhook, Mail, MessageSquare, Hash, Info, Send, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { z } from "zod";
import type { CredentialProfile, InsertCredentialProfile, Notification, InsertNotification, Backup, UserNotificationChannel, DutyUserSchedule } from "@shared/schema";
import { PROMETHEUS_METRIC_PRESETS, type PrometheusMetricConfig } from "@shared/schema";
import { Checkbox } from "@/components/ui/checkbox";

// Schema for Prometheus metric config
const prometheusMetricConfigSchema = z.object({
  id: z.string(),
  metricName: z.string(),
  label: z.string(),
  displayType: z.enum(['bar', 'gauge', 'number', 'text', 'bytes', 'percentage']),
  unit: z.string().optional(),
  labelFilter: z.record(z.string()).optional(),
  transform: z.enum(['toGB', 'toMB', 'toPercent', 'divide1000', 'none']).optional(),
  maxValue: z.number().optional(),
  warningThreshold: z.number().optional(),
  criticalThreshold: z.number().optional(),
});

const credentialFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["mikrotik", "snmp", "prometheus", "proxmox"]),
  credentials: z.object({
    username: z.string().optional(),
    password: z.string().optional(),
    apiPort: z.coerce.number().optional(),
    snmpVersion: z.enum(["1", "2c", "3"]).optional(),
    snmpCommunity: z.string().optional(),
    snmpUsername: z.string().optional(),
    snmpAuthProtocol: z.enum(["MD5", "SHA"]).optional(),
    snmpAuthKey: z.string().optional(),
    snmpPrivProtocol: z.enum(["DES", "AES"]).optional(),
    snmpPrivKey: z.string().optional(),
    // Prometheus node_exporter settings
    prometheusPort: z.coerce.number().optional(),
    prometheusPath: z.string().optional(),
    prometheusScheme: z.enum(["http", "https"]).optional(),
    prometheusMetrics: z.array(prometheusMetricConfigSchema).optional(),
    // Proxmox VE settings
    proxmoxApiTokenId: z.string().optional(),
    proxmoxApiTokenSecret: z.string().optional(),
    proxmoxRealm: z.string().optional(),
    proxmoxPort: z.coerce.number().optional(),
  }),
});

type CredentialFormData = z.infer<typeof credentialFormSchema>;

const notificationFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["webhook", "telegram", "slack", "pushover", "email"]),
  // Legacy webhook fields for backward compatibility
  url: z.string().optional(),
  method: z.enum(["GET", "POST"]).optional(),
  // Type-specific config
  config: z.object({
    // Webhook
    url: z.string().optional(),
    method: z.string().optional(),
    // Telegram
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    // Slack
    webhookUrl: z.string().optional(),
    channel: z.string().optional(),
    username: z.string().optional(),
    iconEmoji: z.string().optional(),
    // Pushover
    pushoverUserKey: z.string().optional(),
    pushoverAppToken: z.string().optional(),
    pushoverDevice: z.string().optional(),
    pushoverSound: z.string().optional(),
    pushoverPriority: z.number().min(-2).max(2).optional(),
    // Email
    emailAddress: z.string().optional(),
  }).optional(),
  messageTemplate: z.string().min(1, "Message template is required"),
  enabled: z.boolean().optional(),
});

type NotificationFormData = z.infer<typeof notificationFormSchema>;

function BackupSection() {
  const { toast } = useToast();
  const [restoring, setRestoring] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState<Backup | null>(null);

  const { data: backups = [], isLoading: backupsLoading } = useQuery<Backup[]>({
    queryKey: ["/api/backups"],
  });

  const { data: backupSettings } = useQuery<{
    schedule: { enabled: boolean; intervalHours: number };
    retention: { maxBackups: number };
  }>({
    queryKey: ["/api/backup-settings"],
  });

  const createBackupMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/backups", { type: "manual" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      toast({ description: "Backup created successfully" });
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to create backup" });
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/backups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backups"] });
      toast({ description: "Backup deleted" });
      setDeletingBackup(null);
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to delete backup" });
    },
  });

  const restoreBackupMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/backups/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credential-profiles"] });
      toast({ description: "Backup restored successfully. Refresh the page to see changes." });
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to restore backup" });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: { schedule?: { enabled: boolean; intervalHours: number }; retention?: { maxBackups: number } }) =>
      apiRequest("PATCH", "/api/backup-settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backup-settings"] });
      toast({ description: "Backup settings updated" });
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to update settings" });
    },
  });

  const handleDownload = async (backup: Backup) => {
    try {
      const response = await fetch(`/api/backups/${backup.id}/download`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backup.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({ variant: "destructive", description: "Failed to download backup" });
    }
  };

  const handleFileRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setRestoring(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await apiRequest("POST", "/api/restore", data);
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credential-profiles"] });
      toast({ description: "Backup restored successfully. Refresh the page to see changes." });
    } catch (error) {
      toast({ variant: "destructive", description: "Failed to restore from file" });
    } finally {
      setRestoring(false);
      event.target.value = "";
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (date: string | Date) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  };

  return (
    <Card data-testid="card-backups">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
        <div>
          <CardTitle>Backup & Restore</CardTitle>
          <CardDescription>
            Create backups and restore your configuration
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => document.getElementById("restore-file-input")?.click()}
            disabled={restoring}
            data-testid="button-restore-file"
          >
            <Upload className="h-4 w-4 mr-2" />
            Restore from File
          </Button>
          <input
            id="restore-file-input"
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileRestore}
          />
          <Button
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending}
            data-testid="button-create-backup"
          >
            <Download className="h-4 w-4 mr-2" />
            {createBackupMutation.isPending ? "Creating..." : "Create Backup"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Scheduled Backups
          </h4>
          <div className="flex items-center justify-between p-4 border rounded-md">
            <div className="flex items-center gap-4">
              <Switch
                checked={backupSettings?.schedule?.enabled || false}
                onCheckedChange={(enabled) =>
                  updateSettingsMutation.mutate({
                    schedule: { enabled, intervalHours: backupSettings?.schedule?.intervalHours || 24 },
                  })
                }
                data-testid="switch-scheduled-backup"
              />
              <div>
                <div className="font-medium">Automatic Backups</div>
                <div className="text-sm text-muted-foreground">
                  {backupSettings?.schedule?.enabled
                    ? `Every ${backupSettings.schedule.intervalHours} hours`
                    : "Disabled"}
                </div>
              </div>
            </div>
            <Select
              value={String(backupSettings?.schedule?.intervalHours || 24)}
              onValueChange={(value) =>
                updateSettingsMutation.mutate({
                  schedule: { enabled: backupSettings?.schedule?.enabled || false, intervalHours: parseInt(value) },
                })
              }
            >
              <SelectTrigger className="w-32" data-testid="select-backup-interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 hour</SelectItem>
                <SelectItem value="6">6 hours</SelectItem>
                <SelectItem value="12">12 hours</SelectItem>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="48">48 hours</SelectItem>
                <SelectItem value="168">1 week</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-md">
            <div>
              <div className="font-medium">Retention Policy</div>
              <div className="text-sm text-muted-foreground">
                Keep last {backupSettings?.retention?.maxBackups || 10} scheduled backups
              </div>
            </div>
            <Select
              value={String(backupSettings?.retention?.maxBackups || 10)}
              onValueChange={(value) =>
                updateSettingsMutation.mutate({
                  retention: { maxBackups: parseInt(value) },
                })
              }
            >
              <SelectTrigger className="w-32" data-testid="select-retention">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 backups</SelectItem>
                <SelectItem value="10">10 backups</SelectItem>
                <SelectItem value="20">20 backups</SelectItem>
                <SelectItem value="50">50 backups</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Backup History
          </h4>
          {backupsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading backups...</div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No backups yet. Create one to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between p-4 border rounded-md hover-elevate"
                  data-testid={`backup-item-${backup.id}`}
                >
                  <div className="flex items-center gap-3">
                    <HardDrive className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        {backup.filename}
                        {backup.type === "scheduled" && (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded">Scheduled</span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(backup.createdAt)} · {formatSize(backup.sizeBytes)}
                        {backup.metadata && (
                          <span className="ml-2">
                            · {backup.metadata.deviceCount} devices, {backup.metadata.mapCount} maps
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDownload(backup)}
                      data-testid={`button-download-${backup.id}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => restoreBackupMutation.mutate(backup.id)}
                      disabled={restoreBackupMutation.isPending}
                      data-testid={`button-restore-${backup.id}`}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingBackup(backup)}
                      data-testid={`button-delete-${backup.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      <AlertDialog open={!!deletingBackup} onOpenChange={(open) => !open && setDeletingBackup(null)}>
        <AlertDialogContent data-testid="dialog-delete-backup-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Backup</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingBackup?.filename}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-backup">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingBackup && deleteBackupMutation.mutate(deletingBackup.id)}
              data-testid="button-confirm-delete-backup"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function DangerZoneSection() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const deleteNetworkDataMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/network-data"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logs"] });
      toast({ 
        description: `Deleted ${data.devicesDeleted} devices, ${data.mapsDeleted} maps, and ${data.logsDeleted} logs` 
      });
      setConfirmDialogOpen(false);
      setConfirmText("");
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to delete network data" });
    },
  });

  if (!isAdmin) return null;

  const canDelete = confirmText === "DELETE";

  return (
    <Card className="border-destructive/50" data-testid="card-danger-zone">
      <CardHeader>
        <CardTitle className="text-destructive flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Destructive actions that cannot be undone
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg border-destructive/30 bg-destructive/5">
            <div>
              <h4 className="font-medium text-foreground">Delete All Network Data</h4>
              <p className="text-sm text-muted-foreground">
                Permanently delete all devices, maps, connections, and logs. Users, credentials, and notification settings will be preserved.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setConfirmDialogOpen(true)}
              data-testid="button-delete-all-network-data"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete All
            </Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirmDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setConfirmDialogOpen(false);
          setConfirmText("");
        }
      }}>
        <AlertDialogContent data-testid="dialog-confirm-delete-network-data">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete All Network Data</AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <span className="block">
                This will permanently delete ALL devices, maps, connections, placements, and logs.
              </span>
              <span className="block font-medium">
                The following will be preserved:
              </span>
              <ul className="list-disc list-inside text-sm">
                <li>User accounts and passwords</li>
                <li>Credential profiles</li>
                <li>Notification channels and settings</li>
                <li>System settings</li>
                <li>Scan profiles</li>
              </ul>
              <span className="block font-medium">
                Type DELETE to confirm:
              </span>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="mt-2"
                data-testid="input-confirm-delete"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-network-data">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => deleteNetworkDataMutation.mutate()}
              disabled={!canDelete || deleteNetworkDataMutation.isPending}
              data-testid="button-confirm-delete-network-data"
            >
              {deleteNetworkDataMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete All Network Data"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

interface LicenseInfo {
  tier: 'free' | 'pro';
  deviceLimit: number | null;
  currentDeviceCount: number;
  canAddDevice: boolean;
  purchaseDate: string | null;
  updatesValidUntil: string | null;
  isUpdateEntitled: boolean;
  fingerprint: string;
  isActivated: boolean;
  buildDate: string;
  readOnly?: boolean;
  readOnlyReason?: string;
}

interface AppConfig {
  licensingServerUrl: string;
}

function LicenseSection() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [activationDialogOpen, setActivationDialogOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const { data: config } = useQuery<AppConfig>({
    queryKey: ["/api/config"],
    staleTime: Infinity,
  });

  const licensingServerUrl = config?.licensingServerUrl || 'https://licensing.corebit.ease.dk';

  const { data: license, isLoading } = useQuery<LicenseInfo>({
    queryKey: ["/api/license"],
  });

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      const response = await fetch(`${licensingServerUrl}/api/stripe/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fingerprint: license?.fingerprint,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start checkout');
      }
      
      const { url } = await response.json();
      
      // Try to redirect - if popup blocked or navigation fails, handle gracefully
      try {
        window.location.href = url;
        // Give the redirect a moment to happen
        setTimeout(() => {
          // If we're still here after 3s, the redirect might have been blocked
          setUpgrading(false);
        }, 3000);
      } catch (navError) {
        // Fallback: open in new tab
        window.open(url, '_blank');
        toast({ description: "Checkout opened in a new tab" });
        setUpgrading(false);
      }
    } catch (error: any) {
      toast({ variant: "destructive", description: error.message || "Failed to start checkout. Please try again." });
      setUpgrading(false);
    }
  };

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      toast({ variant: "destructive", description: "Please enter a license key" });
      return;
    }

    setActivating(true);
    try {
      const activateResponse = await fetch(`${licensingServerUrl}/api/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: licenseKey.trim(),
          fingerprint: license?.fingerprint,
        }),
      });
      
      if (!activateResponse.ok) {
        const error = await activateResponse.json();
        throw new Error(error.error || 'Activation failed');
      }
      
      const { license: signedLicense } = await activateResponse.json();
      
      const localResponse = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signedLicense),
      });
      
      if (!localResponse.ok) {
        const error = await localResponse.json();
        throw new Error(error.error || 'Local activation failed');
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/license"] });
      toast({ description: "License activated successfully!" });
      setActivationDialogOpen(false);
      setLicenseKey('');
    } catch (error: any) {
      toast({ variant: "destructive", description: error.message || "Activation failed" });
    } finally {
      setActivating(false);
    }
  };

  const tierColors = {
    free: 'bg-muted text-muted-foreground',
    pro: 'bg-primary text-primary-foreground',
  };

  return (
    <Card data-testid="card-license">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-5 w-5" />
          License
        </CardTitle>
        <CardDescription>
          Manage your CoreBit license and subscription
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading license info...
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Tier:</span>
                <Badge className={tierColors[license?.tier || 'free']}>
                  {license?.tier === 'pro' ? 'Pro' : 'Free'}
                </Badge>
              </div>
              {license?.isActivated && (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  Activated
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Device Limit:</span>
                <div className="font-medium">
                  {license?.deviceLimit === null ? 'Unlimited' : license?.deviceLimit}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Current Devices:</span>
                <div className="font-medium">{license?.currentDeviceCount || 0}</div>
              </div>
              {license?.tier === 'pro' && (
                <>
                  <div>
                    <span className="text-muted-foreground">Purchase Date:</span>
                    <div className="font-medium">
                      {license?.purchaseDate 
                        ? new Date(license.purchaseDate).toLocaleDateString() 
                        : '-'}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Updates Valid Until:</span>
                    <div className="font-medium">
                      {license?.updatesValidUntil 
                        ? new Date(license.updatesValidUntil).toLocaleDateString() 
                        : '-'}
                    </div>
                  </div>
                </>
              )}
            </div>

            {license?.tier === 'free' && (
              <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                <p className="text-sm">
                  You're using the free tier with a limit of {license?.deviceLimit} devices.
                </p>
                <p className="text-sm text-muted-foreground">
                  Upgrade to Pro for unlimited devices and priority support.
                </p>
              </div>
            )}

            {license?.readOnly && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                    Read-Only Mode
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  You have {license?.currentDeviceCount} devices but no Pro license. 
                  Existing devices continue working, but editing device connections (IP, credentials, type) 
                  and deleting devices is disabled.
                </p>
                <p className="text-sm text-muted-foreground">
                  Upgrade to Pro or activate your license to unlock full editing.
                </p>
              </div>
            )}

            {!license?.isUpdateEntitled && license?.tier === 'pro' && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-2">
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  Your update entitlement has expired. Renew to get access to new versions.
                </p>
              </div>
            )}

            <div className="text-xs text-muted-foreground pt-2 border-t">
              <div>Server Fingerprint: <code className="bg-muted px-1 rounded">{license?.fingerprint}</code></div>
              <div className="mt-1">Build Date: {license?.buildDate}</div>
            </div>

            <div className="flex gap-2 pt-2">
              {license?.tier === 'free' && (
                <Button 
                  onClick={handleUpgrade}
                  disabled={upgrading}
                  data-testid="button-upgrade"
                >
                  {upgrading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Redirecting...
                    </>
                  ) : (
                    <>
                      <Crown className="h-4 w-4 mr-2" />
                      Upgrade to Pro
                    </>
                  )}
                </Button>
              )}
              {isAdmin && (
                <Button 
                  variant="outline"
                  onClick={() => setActivationDialogOpen(true)}
                  data-testid="button-activate-license"
                >
                  Enter License Key
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={activationDialogOpen} onOpenChange={setActivationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate License</DialogTitle>
            <DialogDescription>
              Enter your license key to activate CoreBit Pro
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="license-key">License Key</Label>
              <Input
                id="license-key"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                data-testid="input-license-key"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Server Fingerprint: <code className="bg-muted px-1 rounded">{license?.fingerprint}</code>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivationDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleActivate}
              disabled={activating}
              data-testid="button-confirm-activate"
            >
              {activating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Activating...
                </>
              ) : (
                'Activate'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function VersionSection() {
  const { data: versionData } = useQuery<{
    version: string;
    buildDate: string;
    buildNumber: number;
  }>({
    queryKey: ["/api/version"],
  });

  return (
    <Card data-testid="card-version">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="h-4 w-4" />
          About CoreBit
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>Version:</span>
          <Badge variant="secondary" className="font-mono">
            v{versionData?.version || "dev"}
          </Badge>
          {versionData?.buildNumber ? (
            <span className="text-xs">Build {versionData.buildNumber}</span>
          ) : null}
          {versionData?.buildDate && (
            <span className="text-xs">({versionData.buildDate})</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsHistorySection() {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const { data: retentionSettings, isLoading } = useQuery<{
    retentionHours: number;
    enableMetricsHistory: boolean;
  }>({
    queryKey: ["/api/settings/metrics-history"],
  });

  const [retentionHours, setRetentionHours] = useState(24);
  const [enableMetricsHistory, setEnableMetricsHistory] = useState(true);

  useEffect(() => {
    if (retentionSettings) {
      setRetentionHours(retentionSettings.retentionHours ?? 24);
      setEnableMetricsHistory(retentionSettings.enableMetricsHistory ?? true);
    }
  }, [retentionSettings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/metrics-history", {
        retentionHours,
        enableMetricsHistory,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/metrics-history"] });
      toast({ description: "Metrics history settings saved" });
    } catch (error: any) {
      toast({ variant: "destructive", description: error.message || "Failed to save settings" });
    } finally {
      setIsSaving(false);
    }
  };

  const retentionPresets = [
    { label: "1 hour", value: 1 },
    { label: "6 hours", value: 6 },
    { label: "12 hours", value: 12 },
    { label: "24 hours", value: 24 },
    { label: "48 hours", value: 48 },
    { label: "72 hours", value: 72 },
    { label: "7 days", value: 168 },
  ];

  return (
    <Card data-testid="card-metrics-history">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Metrics History
        </CardTitle>
        <CardDescription>
          Configure how long device metrics and bandwidth data are stored for historical charts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading settings...
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="enable-metrics-history">Enable Metrics History</Label>
                <p className="text-sm text-muted-foreground">
                  Store historical CPU, memory, disk, and bandwidth data
                </p>
              </div>
              <Switch
                id="enable-metrics-history"
                checked={enableMetricsHistory}
                onCheckedChange={setEnableMetricsHistory}
                data-testid="switch-enable-metrics-history"
              />
            </div>

            <div className="space-y-2">
              <Label>Default Retention Period</Label>
              <p className="text-sm text-muted-foreground">
                Data older than this will be automatically deleted. Individual devices can override this.
              </p>
              <Select
                value={String(retentionHours)}
                onValueChange={(val) => setRetentionHours(Number(val))}
                disabled={!enableMetricsHistory}
              >
                <SelectTrigger className="w-48" data-testid="select-retention-hours">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {retentionPresets.map((preset) => (
                    <SelectItem key={preset.value} value={String(preset.value)}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="pt-2">
              <Button
                onClick={handleSave}
                disabled={isSaving}
                data-testid="button-save-metrics-settings"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Settings"
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const userFormSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(4, "Password must be at least 4 characters").optional(),
  displayName: z.string().optional(),
  role: z.enum(["admin", "superuser", "viewer"]),
});

type UserFormData = z.infer<typeof userFormSchema>;

function UserManagementSection() {
  const { toast } = useToast();
  const { user: currentUser, isAdmin } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [channelsDialogUser, setChannelsDialogUser] = useState<User | null>(null);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<UserNotificationChannel | null>(null);
  const [deletingChannel, setDeletingChannel] = useState<UserNotificationChannel | null>(null);

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: isAdmin,
  });

  // Fetch notification channels for the selected user
  const { data: userChannels = [], refetch: refetchUserChannels } = useQuery<UserNotificationChannel[]>({
    queryKey: ["/api/user-notification-channels", channelsDialogUser?.id],
    queryFn: async () => {
      if (!channelsDialogUser) return [];
      const res = await fetch(`/api/user-notification-channels?userId=${channelsDialogUser.id}`);
      if (!res.ok) throw new Error("Failed to fetch channels");
      return res.json();
    },
    enabled: !!channelsDialogUser,
  });

  const channelForm = useForm<UserChannelFormData>({
    resolver: zodResolver(userChannelFormSchema),
    defaultValues: {
      name: "",
      type: "webhook",
      enabled: true,
      config: {
        url: "",
        method: "POST",
        botToken: "",
        chatId: "",
        messageTemplate: "[Device.Name] ([Device.Address]) is now [Service.Status]",
        pushoverUserKey: "",
        pushoverAppToken: "",
        pushoverDevice: "",
        pushoverSound: "pushover",
        pushoverPriority: 0,
      },
    },
  });

  useEffect(() => {
    if (editingChannel) {
      channelForm.reset({
        name: editingChannel.name,
        type: editingChannel.type as "webhook" | "email" | "telegram" | "slack" | "pushover",
        enabled: editingChannel.enabled,
        config: {
          url: "",
          method: "POST",
          botToken: "",
          chatId: "",
          messageTemplate: "[Device.Name] ([Device.Address]) is now [Service.Status]",
          pushoverUserKey: "",
          pushoverAppToken: "",
          pushoverDevice: "",
          pushoverSound: "pushover",
          pushoverPriority: 0,
          ...(editingChannel.config as any),
        },
      });
    } else {
      channelForm.reset({
        name: "",
        type: "webhook",
        enabled: true,
        config: {
          url: "",
          method: "POST",
          botToken: "",
          chatId: "",
          messageTemplate: "[Device.Name] ([Device.Address]) is now [Service.Status]",
          pushoverUserKey: "",
          pushoverAppToken: "",
          pushoverDevice: "",
          pushoverSound: "pushover",
          pushoverPriority: 0,
        },
      });
    }
  }, [editingChannel, channelForm]);

  // Reset config fields when channel type changes
  const watchedType = channelForm.watch("type");
  useEffect(() => {
    if (!editingChannel) {
      // When adding a new channel and type changes, ensure config fields are set
      const currentConfig = channelForm.getValues("config");
      channelForm.setValue("config", {
        url: currentConfig?.url || "",
        method: currentConfig?.method || "POST",
        botToken: currentConfig?.botToken || "",
        chatId: currentConfig?.chatId || "",
        messageTemplate: currentConfig?.messageTemplate || "[Device.Name] ([Device.Address]) is now [Service.Status]",
      });
    }
  }, [watchedType, editingChannel, channelForm]);

  const createChannelMutation = useMutation({
    mutationFn: async (data: UserChannelFormData) =>
      apiRequest("POST", "/api/user-notification-channels", { ...data, userId: channelsDialogUser?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-notification-channels", channelsDialogUser?.id] });
      toast({ description: "Notification channel created" });
      setChannelDialogOpen(false);
      setEditingChannel(null);
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to create channel" });
    },
  });

  const updateChannelMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<UserChannelFormData> }) =>
      apiRequest("PATCH", `/api/user-notification-channels/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-notification-channels", channelsDialogUser?.id] });
      toast({ description: "Notification channel updated" });
      setChannelDialogOpen(false);
      setEditingChannel(null);
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to update channel" });
    },
  });

  const deleteChannelMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/user-notification-channels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-notification-channels", channelsDialogUser?.id] });
      toast({ description: "Notification channel deleted" });
      setDeletingChannel(null);
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to delete channel" });
    },
  });

  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);
  
  const testChannelMutation = useMutation({
    mutationFn: async (id: string) => {
      setTestingChannelId(id);
      return apiRequest("POST", `/api/user-notification-channels/${id}/test`);
    },
    onSuccess: () => {
      toast({ description: "Test notification sent successfully" });
      setTestingChannelId(null);
    },
    onError: (error: any) => {
      toast({ variant: "destructive", description: error?.message || "Failed to send test notification" });
      setTestingChannelId(null);
    },
  });

  const handleChannelSubmit = (data: UserChannelFormData) => {
    if (editingChannel) {
      updateChannelMutation.mutate({ id: editingChannel.id, data });
    } else {
      createChannelMutation.mutate(data);
    }
  };

  const handleOpenChannels = (user: User) => {
    setChannelsDialogUser(user);
    setEditingChannel(null);
  };

  const handleCloseChannelsDialog = () => {
    setChannelsDialogUser(null);
    setEditingChannel(null);
  };

  const form = useForm<UserFormData>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      username: "",
      password: "",
      displayName: "",
      role: "viewer",
    },
  });

  useEffect(() => {
    if (editingUser) {
      form.reset({
        username: editingUser.username,
        password: "",
        displayName: editingUser.displayName || "",
        role: editingUser.role,
      });
    } else {
      form.reset({
        username: "",
        password: "",
        displayName: "",
        role: "viewer",
      });
    }
  }, [editingUser, form]);

  const createUserMutation = useMutation({
    mutationFn: async (data: UserFormData) =>
      apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ description: "User created successfully" });
      handleDialogClose();
    },
    onError: (error: any) => {
      toast({ variant: "destructive", description: error?.message || "Failed to create user" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<UserFormData> }) =>
      apiRequest("PATCH", `/api/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ description: "User updated successfully" });
      handleDialogClose();
    },
    onError: (error: any) => {
      toast({ variant: "destructive", description: error?.message || "Failed to update user" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ description: "User deleted" });
      setDeletingUser(null);
    },
    onError: (error: any) => {
      toast({ variant: "destructive", description: error?.message || "Failed to delete user" });
    },
  });

  const handleDialogClose = () => {
    setDialogOpen(false);
    setEditingUser(null);
    form.reset();
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setDialogOpen(true);
  };

  const handleSubmit = (data: UserFormData) => {
    if (editingUser) {
      const updateData: Partial<UserFormData> = {
        displayName: data.displayName,
        role: data.role,
      };
      if (data.password && data.password.length > 0) {
        updateData.password = data.password;
      }
      updateUserMutation.mutate({ id: editingUser.id, data: updateData });
    } else {
      createUserMutation.mutate(data);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin': return <Crown className="h-4 w-4 text-yellow-500" />;
      case 'superuser': return <Shield className="h-4 w-4 text-blue-500" />;
      case 'viewer': return <Eye className="h-4 w-4 text-muted-foreground" />;
      default: return null;
    }
  };

  const getRoleDescription = (role: string) => {
    switch (role) {
      case 'admin': return "Full access including user management and settings";
      case 'superuser': return "Dashboard access, can modify devices and maps";
      case 'viewer': return "Read-only access to view the network";
      default: return "";
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <Card data-testid="card-user-management">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            User Management
          </CardTitle>
          <CardDescription>
            Manage users and their access levels
          </CardDescription>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-user">
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingUser ? "Edit User" : "Add User"}</DialogTitle>
              <DialogDescription>
                {editingUser ? "Update user details and role" : "Create a new user account"}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          disabled={!!editingUser}
                          placeholder="Enter username"
                          autoComplete="off"
                          data-testid="input-user-username"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Enter display name"
                          autoComplete="off"
                          data-testid="input-user-displayname"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{editingUser ? "New Password (leave empty to keep current)" : "Password"}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder={editingUser ? "Enter new password" : "Enter password"}
                          autoComplete="new-password"
                          data-testid="input-user-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-user-role">
                            <SelectValue placeholder="Select a role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="admin" data-testid="role-option-admin">
                            <div className="flex items-center gap-2">
                              <Crown className="h-4 w-4 text-yellow-500" />
                              Admin
                            </div>
                          </SelectItem>
                          <SelectItem value="superuser" data-testid="role-option-superuser">
                            <div className="flex items-center gap-2">
                              <Shield className="h-4 w-4 text-blue-500" />
                              Superuser
                            </div>
                          </SelectItem>
                          <SelectItem value="viewer" data-testid="role-option-viewer">
                            <div className="flex items-center gap-2">
                              <Eye className="h-4 w-4 text-muted-foreground" />
                              Viewer
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        {getRoleDescription(field.value)}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDialogClose}
                    data-testid="button-cancel-user"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createUserMutation.isPending || updateUserMutation.isPending}
                    data-testid="button-save-user"
                  >
                    {(createUserMutation.isPending || updateUserMutation.isPending) && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    {editingUser ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No users found
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-4 border rounded-md hover-elevate"
                data-testid={`user-item-${user.id}`}
              >
                <div className="flex items-center gap-3">
                  {getRoleIcon(user.role)}
                  <div>
                    <div className="font-medium text-foreground flex items-center gap-2">
                      {user.displayName || user.username}
                      {user.id === currentUser?.id && (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">You</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      @{user.username} · {user.role}
                      {user.lastLogin && (
                        <span className="ml-2">
                          · Last login: {new Date(user.lastLogin).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenChannels(user)}
                    title="Manage notification channels"
                    data-testid={`button-channels-user-${user.id}`}
                  >
                    <Bell className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEdit(user)}
                    data-testid={`button-edit-user-${user.id}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeletingUser(user)}
                    disabled={user.id === currentUser?.id}
                    data-testid={`button-delete-user-${user.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <AlertDialogContent data-testid="dialog-delete-user-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingUser?.displayName || deletingUser?.username}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-user">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingUser && deleteUserMutation.mutate(deletingUser.id)}
              data-testid="button-confirm-delete-user"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* User Notification Channels Dialog */}
      <Dialog open={!!channelsDialogUser} onOpenChange={(open) => !open && handleCloseChannelsDialog()}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notification Channels - {channelsDialogUser?.displayName || channelsDialogUser?.username}
            </DialogTitle>
            <DialogDescription>
              Configure where this user receives on-duty alerts
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => {
                  setEditingChannel(null);
                  setChannelDialogOpen(true);
                }}
                data-testid="button-add-user-channel"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Channel
              </Button>
            </div>

            {userChannels.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No notification channels configured for this user
              </div>
            ) : (
              <div className="space-y-2">
                {userChannels.map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center justify-between p-3 border rounded-md"
                    data-testid={`user-channel-item-${channel.id}`}
                  >
                    <div className="flex items-center gap-3">
                      {channel.type === 'webhook' && <Webhook className="h-4 w-4 text-blue-500" />}
                      {channel.type === 'email' && <Mail className="h-4 w-4 text-green-500" />}
                      {channel.type === 'telegram' && <MessageSquare className="h-4 w-4 text-sky-500" />}
                      {channel.type === 'slack' && <Hash className="h-4 w-4 text-pink-500" />}
                      {channel.type === 'pushover' && <Bell className="h-4 w-4 text-purple-500" />}
                      <div>
                        <div className="font-medium text-foreground flex items-center gap-2">
                          {channel.name}
                          {!channel.enabled && (
                            <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Disabled</span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground capitalize">
                          {channel.type}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => testChannelMutation.mutate(channel.id)}
                        disabled={testingChannelId === channel.id}
                        title="Send test notification"
                        data-testid={`button-test-channel-${channel.id}`}
                      >
                        {testingChannelId === channel.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingChannel(channel);
                          setChannelDialogOpen(true);
                        }}
                        data-testid={`button-edit-channel-${channel.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingChannel(channel)}
                        data-testid={`button-delete-channel-${channel.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Channel Dialog */}
      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingChannel ? "Edit Channel" : "Add Notification Channel"}</DialogTitle>
            <DialogDescription>
              Configure a notification channel for {channelsDialogUser?.displayName || channelsDialogUser?.username}
            </DialogDescription>
          </DialogHeader>
          <Form {...channelForm}>
            <form onSubmit={channelForm.handleSubmit(handleChannelSubmit)} className="space-y-4">
              <FormField
                control={channelForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Channel Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., My Telegram" data-testid="input-channel-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={channelForm.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-channel-type">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="webhook">Webhook</SelectItem>
                        <SelectItem value="telegram">Telegram</SelectItem>
                        <SelectItem value="slack">Slack</SelectItem>
                        <SelectItem value="pushover">Pushover</SelectItem>
                        <SelectItem value="email">Email (coming soon)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={channelForm.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Enabled</FormLabel>
                      <FormDescription className="text-xs">
                        Receive notifications on this channel
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              
              {channelForm.watch("type") === "webhook" && (
                <>
                  <FormField
                    control={channelForm.control}
                    name="config.url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Webhook URL</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="https://..." data-testid="input-channel-url" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.method"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Method</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "POST"}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="POST">POST</SelectItem>
                            <SelectItem value="GET">GET</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {channelForm.watch("type") === "telegram" && (
                <>
                  <FormField
                    control={channelForm.control}
                    name="config.botToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bot Token</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="123456:ABC-DEF..." data-testid="input-channel-bot-token" />
                        </FormControl>
                        <FormDescription className="text-xs">Get this from @BotFather on Telegram</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.chatId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Chat ID</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="-1001234567890" data-testid="input-channel-chat-id" />
                        </FormControl>
                        <FormDescription className="text-xs">Group or user chat ID to send messages to</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {channelForm.watch("type") === "slack" && (
                <>
                  <FormField
                    control={channelForm.control}
                    name="config.webhookUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Slack Webhook URL</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="https://hooks.slack.com/services/..." data-testid="input-channel-slack-webhook" />
                        </FormControl>
                        <FormDescription className="text-xs">Create an incoming webhook in your Slack workspace settings</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.channel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Channel Override (optional)</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="#alerts" data-testid="input-channel-slack-channel" />
                        </FormControl>
                        <FormDescription className="text-xs">Override the default webhook channel</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bot Username (optional)</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="CoreBit" data-testid="input-channel-slack-username" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.iconEmoji"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Icon Emoji (optional)</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder=":warning:" data-testid="input-channel-slack-icon" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {channelForm.watch("type") === "pushover" && (
                <>
                  <FormField
                    control={channelForm.control}
                    name="config.pushoverUserKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>User Key</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Your Pushover user key" data-testid="input-channel-pushover-user" />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Find this on your Pushover dashboard
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.pushoverAppToken"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Token</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Your app API token" data-testid="input-channel-pushover-token" />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Create an app at pushover.net/apps/build
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.pushoverDevice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Device (optional)</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="Leave empty for all devices" data-testid="input-channel-pushover-device" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.pushoverSound"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sound</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || "pushover"}>
                          <FormControl>
                            <SelectTrigger data-testid="select-channel-pushover-sound">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="pushover">Pushover (default)</SelectItem>
                            <SelectItem value="bike">Bike</SelectItem>
                            <SelectItem value="bugle">Bugle</SelectItem>
                            <SelectItem value="cashregister">Cash Register</SelectItem>
                            <SelectItem value="classical">Classical</SelectItem>
                            <SelectItem value="cosmic">Cosmic</SelectItem>
                            <SelectItem value="falling">Falling</SelectItem>
                            <SelectItem value="gamelan">Gamelan</SelectItem>
                            <SelectItem value="incoming">Incoming</SelectItem>
                            <SelectItem value="intermission">Intermission</SelectItem>
                            <SelectItem value="magic">Magic</SelectItem>
                            <SelectItem value="mechanical">Mechanical</SelectItem>
                            <SelectItem value="pianobar">Piano Bar</SelectItem>
                            <SelectItem value="siren">Siren</SelectItem>
                            <SelectItem value="spacealarm">Space Alarm</SelectItem>
                            <SelectItem value="tugboat">Tugboat</SelectItem>
                            <SelectItem value="alien">Alien</SelectItem>
                            <SelectItem value="climb">Climb</SelectItem>
                            <SelectItem value="persistent">Persistent</SelectItem>
                            <SelectItem value="echo">Echo</SelectItem>
                            <SelectItem value="updown">Up Down</SelectItem>
                            <SelectItem value="vibrate">Vibrate</SelectItem>
                            <SelectItem value="none">None (silent)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={channelForm.control}
                    name="config.pushoverPriority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={(v) => field.onChange(parseInt(v))} value={String(field.value ?? 0)}>
                          <FormControl>
                            <SelectTrigger data-testid="select-channel-pushover-priority">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="-2">Lowest (no alert)</SelectItem>
                            <SelectItem value="-1">Low (quiet)</SelectItem>
                            <SelectItem value="0">Normal</SelectItem>
                            <SelectItem value="1">High</SelectItem>
                            <SelectItem value="2">Emergency (requires ack)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <FormField
                control={channelForm.control}
                name="config.messageTemplate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Message Template</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="[Device.Name] is now [Service.Status]"
                        data-testid="input-channel-message"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Available: [Device.Name], [Device.Address], [Service.Status], [Status.Old], [Status.New]
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit" disabled={createChannelMutation.isPending || updateChannelMutation.isPending}>
                  {(createChannelMutation.isPending || updateChannelMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editingChannel ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Channel Confirmation */}
      <AlertDialog open={!!deletingChannel} onOpenChange={(open) => !open && setDeletingChannel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Notification Channel</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingChannel?.name}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingChannel && deleteChannelMutation.mutate(deletingChannel.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// User Notification Channels schema
const userChannelFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["webhook", "email", "telegram", "slack", "pushover"]),
  enabled: z.boolean().optional(),
  config: z.object({
    url: z.string().optional(),
    method: z.enum(["GET", "POST"]).optional(),
    messageTemplate: z.string().optional(),
    emailAddress: z.string().email().optional().or(z.literal("")),
    botToken: z.string().optional(),
    chatId: z.string().optional(),
    // Slack
    webhookUrl: z.string().optional(),
    channel: z.string().optional(),
    username: z.string().optional(),
    iconEmoji: z.string().optional(),
    // Pushover
    pushoverUserKey: z.string().optional(),
    pushoverAppToken: z.string().optional(),
    pushoverDevice: z.string().optional(),
    pushoverSound: z.string().optional(),
    pushoverPriority: z.number().min(-2).max(2).optional(),
  }),
});

type UserChannelFormData = z.infer<typeof userChannelFormSchema>;

interface OnDutyUserSchedule extends DutyUserSchedule {
  user: { id: string; username: string; displayName: string | null };
}

function OnDutyScheduleSection() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [addingUserShift, setAddingUserShift] = useState<'day' | 'night' | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const { data: schedules = [], isLoading } = useQuery<OnDutyUserSchedule[]>({
    queryKey: ["/api/duty-user-schedules"],
    enabled: isAdmin,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: isAdmin,
  });

  const { data: shiftConfig } = useQuery<{
    dayShiftStart: string;
    dayShiftEnd: string;
    timezone: string;
  }>({
    queryKey: ["/api/duty-shift-config"],
    enabled: isAdmin,
  });

  const { data: onDutyNow } = useQuery<{ shift: string | null; users: { id: string; username: string; displayName: string | null }[] }>({
    queryKey: ["/api/duty-on-call"],
    enabled: isAdmin,
    refetchInterval: 60000,
  });

  const [dayStart, setDayStart] = useState(shiftConfig?.dayShiftStart || "08:00");
  const [dayEnd, setDayEnd] = useState(shiftConfig?.dayShiftEnd || "20:00");
  const [timezone, setTimezone] = useState(shiftConfig?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);

  useEffect(() => {
    if (shiftConfig) {
      setDayStart(shiftConfig.dayShiftStart);
      setDayEnd(shiftConfig.dayShiftEnd);
      setTimezone(shiftConfig.timezone);
    }
  }, [shiftConfig]);

  const updateShiftConfigMutation = useMutation({
    mutationFn: async (config: { dayShiftStart: string; dayShiftEnd: string; timezone: string }) =>
      apiRequest("PUT", "/api/duty-shift-config", config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/duty-shift-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/duty-on-call"] });
      toast({ description: "Shift times updated" });
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to update shift times" });
    },
  });

  const addUserScheduleMutation = useMutation({
    mutationFn: async ({ userId, shift }: { userId: string; shift: 'day' | 'night' }) =>
      apiRequest("POST", "/api/duty-user-schedules", { userId, shift }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/duty-user-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/duty-on-call"] });
      toast({ description: "User assigned to shift" });
      setAddingUserShift(null);
      setSelectedUserId("");
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to assign user to shift" });
    },
  });

  const removeUserScheduleMutation = useMutation({
    mutationFn: async (scheduleId: string) =>
      apiRequest("DELETE", `/api/duty-user-schedules/${scheduleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/duty-user-schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/duty-on-call"] });
      toast({ description: "User removed from shift" });
    },
    onError: () => {
      toast({ variant: "destructive", description: "Failed to remove user from shift" });
    },
  });

  const dayShiftUsers = schedules.filter(s => s.shift === 'day');
  const nightShiftUsers = schedules.filter(s => s.shift === 'night');

  const availableUsersForShift = (shift: 'day' | 'night') => {
    const assignedUserIds = schedules.filter(s => s.shift === shift).map(s => s.userId);
    return users.filter(u => !assignedUserIds.includes(u.id));
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <Card data-testid="card-on-duty-schedule">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          On-Duty Schedule
        </CardTitle>
        <CardDescription>
          Configure shift times and assign operators to day/night shifts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {onDutyNow && onDutyNow.shift && onDutyNow.users.length > 0 && (
          <div className="p-4 border rounded-md bg-primary/5 border-primary/20">
            <div className="flex items-center gap-3">
              {onDutyNow.shift === "day" ? (
                <Sun className="h-5 w-5 text-yellow-500" />
              ) : (
                <Moon className="h-5 w-5 text-blue-400" />
              )}
              <div>
                <div className="font-medium text-foreground">
                  Currently On Duty ({onDutyNow.shift} shift)
                </div>
                <div className="text-sm text-muted-foreground">
                  {onDutyNow.users.map(u => u.displayName || u.username).join(", ")}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 border rounded-md space-y-4">
          <h4 className="font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Shift Times
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-yellow-500" />
                Day Shift Start
              </Label>
              <Input
                type="time"
                value={dayStart}
                onChange={(e) => setDayStart(e.target.value)}
                data-testid="input-day-shift-start"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Moon className="h-4 w-4 text-blue-400" />
                Night Shift Start (Day End)
              </Label>
              <Input
                type="time"
                value={dayEnd}
                onChange={(e) => setDayEnd(e.target.value)}
                data-testid="input-day-shift-end"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger data-testid="select-timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/New_York">America/New_York (ET)</SelectItem>
                <SelectItem value="America/Chicago">America/Chicago (CT)</SelectItem>
                <SelectItem value="America/Denver">America/Denver (MT)</SelectItem>
                <SelectItem value="America/Los_Angeles">America/Los_Angeles (PT)</SelectItem>
                <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                <SelectItem value="Europe/Paris">Europe/Paris (CET)</SelectItem>
                <SelectItem value="Asia/Tokyo">Asia/Tokyo (JST)</SelectItem>
                <SelectItem value="Australia/Sydney">Australia/Sydney (AEST)</SelectItem>
                <SelectItem value="UTC">UTC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => updateShiftConfigMutation.mutate({ dayShiftStart: dayStart, dayShiftEnd: dayEnd, timezone })}
            disabled={updateShiftConfigMutation.isPending}
            data-testid="button-save-shift-config"
          >
            {updateShiftConfigMutation.isPending ? "Saving..." : "Save Shift Times"}
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="p-4 border rounded-md space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium flex items-center gap-2">
                <Sun className="h-4 w-4 text-yellow-500" />
                Day Shift Operators
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingUserShift('day')}
                data-testid="button-add-day-shift-user"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : dayShiftUsers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">
                No operators assigned to day shift
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {dayShiftUsers.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-sm"
                  >
                    <span>{schedule.user.displayName || schedule.user.username}</span>
                    <button
                      className="ml-1 text-muted-foreground hover:text-destructive"
                      onClick={() => removeUserScheduleMutation.mutate(schedule.id)}
                      data-testid={`button-remove-day-${schedule.userId}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 border rounded-md space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium flex items-center gap-2">
                <Moon className="h-4 w-4 text-blue-400" />
                Night Shift Operators
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingUserShift('night')}
                data-testid="button-add-night-shift-user"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : nightShiftUsers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">
                No operators assigned to night shift
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {nightShiftUsers.map((schedule) => (
                  <div
                    key={schedule.id}
                    className="flex items-center gap-1 px-2 py-1 bg-muted rounded text-sm"
                  >
                    <span>{schedule.user.displayName || schedule.user.username}</span>
                    <button
                      className="ml-1 text-muted-foreground hover:text-destructive"
                      onClick={() => removeUserScheduleMutation.mutate(schedule.id)}
                      data-testid={`button-remove-night-${schedule.userId}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>

      <Dialog open={!!addingUserShift} onOpenChange={(open) => !open && setAddingUserShift(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add {addingUserShift === 'day' ? 'Day' : 'Night'} Shift Operator
            </DialogTitle>
            <DialogDescription>
              Select a user to assign to the {addingUserShift} shift
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger data-testid="select-shift-user">
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                {addingUserShift && availableUsersForShift(addingUserShift).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.displayName || user.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button
                onClick={() => {
                  if (addingUserShift && selectedUserId) {
                    addUserScheduleMutation.mutate({ userId: selectedUserId, shift: addingUserShift });
                  }
                }}
                disabled={!selectedUserId || addUserScheduleMutation.isPending}
                data-testid="button-confirm-add-shift-user"
              >
                {addUserScheduleMutation.isPending ? "Adding..." : "Add to Shift"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function NotificationDialog({ 
  notification, 
  open, 
  onOpenChange 
}: { 
  notification?: Notification; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const isEdit = !!notification;

  const form = useForm<NotificationFormData>({
    resolver: zodResolver(notificationFormSchema),
    defaultValues: {
      name: "",
      type: "webhook",
      url: "",
      method: "POST",
      config: {},
      messageTemplate: "Device [Device.Name] ([Device.Address]) changed status: [Status.Old] → [Status.New]",
      enabled: true,
    },
  });

  const selectedType = form.watch("type");

  useEffect(() => {
    if (notification) {
      form.reset({
        name: notification.name,
        type: (notification.type as any) || "webhook",
        url: notification.url || "",
        method: (notification.method as "GET" | "POST") || "POST",
        config: (notification.config as any) || {},
        messageTemplate: notification.messageTemplate,
        enabled: notification.enabled,
      });
    } else {
      form.reset({
        name: "",
        type: "webhook",
        url: "",
        method: "POST",
        config: {},
        messageTemplate: "Device [Device.Name] ([Device.Address]) changed status: [Status.Old] → [Status.New]",
        enabled: true,
      });
    }
  }, [notification, open, form]);

  const createMutation = useMutation({
    mutationFn: async (data: InsertNotification) => 
      apiRequest("POST", "/api/notifications", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ description: "Notification created successfully" });
      onOpenChange(false);
      form.reset();
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to create notification" 
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertNotification) =>
      apiRequest("PATCH", `/api/notifications/${notification?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ description: "Notification updated successfully" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update notification" 
      });
    },
  });

  const onSubmit = (data: NotificationFormData) => {
    if (isEdit) {
      updateMutation.mutate(data as any);
    } else {
      createMutation.mutate(data as any);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-notification">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">
            {isEdit ? "Edit Notification" : "Create Notification"}
          </DialogTitle>
          <DialogDescription>
            {isEdit 
              ? "Update the notification settings." 
              : "Create a new notification endpoint for device status alerts."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notification Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="My Alert" data-testid="input-notification-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-notification-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="webhook">Webhook</SelectItem>
                      <SelectItem value="telegram">Telegram</SelectItem>
                      <SelectItem value="slack">Slack</SelectItem>
                      <SelectItem value="pushover">Pushover</SelectItem>
                      <SelectItem value="email">Email (coming soon)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedType === "webhook" && (
              <>
                <FormField
                  control={form.control}
                  name="config.url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Webhook URL</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="https://..." data-testid="input-notification-url" />
                      </FormControl>
                      <FormDescription className="space-y-1">
                        <div><strong>For GET:</strong> End URL with parameter name and = (e.g., <code className="text-xs">...?text=</code>)</div>
                        <div><strong>For POST:</strong> Message sent as request body</div>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.method"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>HTTP Method</FormLabel>
                      <Select value={field.value || "POST"} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-notification-method">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="GET">GET</SelectItem>
                          <SelectItem value="POST">POST</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {selectedType === "telegram" && (
              <>
                <FormField
                  control={form.control}
                  name="config.botToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bot Token</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="123456:ABC-DEF..." data-testid="input-telegram-token" />
                      </FormControl>
                      <FormDescription>Get this from @BotFather on Telegram</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.chatId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chat ID</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="-1001234567890" data-testid="input-telegram-chat" />
                      </FormControl>
                      <FormDescription>Group or user chat ID to send messages to</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {selectedType === "slack" && (
              <>
                <FormField
                  control={form.control}
                  name="config.webhookUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slack Webhook URL</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="https://hooks.slack.com/services/..." data-testid="input-slack-webhook" />
                      </FormControl>
                      <FormDescription>Create an incoming webhook in your Slack workspace settings</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.channel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Channel Override (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="#alerts" data-testid="input-slack-channel" />
                      </FormControl>
                      <FormDescription>Override the default webhook channel</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bot Username (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="CoreBit" data-testid="input-slack-username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.iconEmoji"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Icon Emoji (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder=":warning:" data-testid="input-slack-icon" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {selectedType === "pushover" && (
              <>
                <FormField
                  control={form.control}
                  name="config.pushoverUserKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>User Key</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Your Pushover user key" data-testid="input-pushover-user" />
                      </FormControl>
                      <FormDescription>Find this on your Pushover dashboard</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.pushoverAppToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Token</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Your app API token" data-testid="input-pushover-token" />
                      </FormControl>
                      <FormDescription>Create an app at pushover.net/apps/build</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.pushoverDevice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Device (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} placeholder="Leave empty for all devices" data-testid="input-pushover-device" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="config.pushoverSound"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sound</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "pushover"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-pushover-sound">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pushover">Pushover (default)</SelectItem>
                          <SelectItem value="siren">Siren</SelectItem>
                          <SelectItem value="spacealarm">Space Alarm</SelectItem>
                          <SelectItem value="mechanical">Mechanical</SelectItem>
                          <SelectItem value="persistent">Persistent</SelectItem>
                          <SelectItem value="none">None (silent)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <FormField
              control={form.control}
              name="messageTemplate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message Template</FormLabel>
                  <FormControl>
                    <Textarea 
                      {...field} 
                      placeholder="Device [Device.Name] status changed to [Service.Status]"
                      className="min-h-[100px]"
                      data-testid="input-notification-message"
                    />
                  </FormControl>
                  <FormDescription className="space-y-1">
                    <div>Available variables:</div>
                    <div className="font-mono text-xs space-x-2 flex flex-wrap gap-1">
                      <span>[Device.Name]</span>
                      <span>[Device.Address]</span>
                      <span>[Device.Identity]</span>
                      <span>[Device.Type]</span>
                      <span>[Service.Status]</span>
                      <span>[Status.Old]</span>
                      <span>[Status.New]</span>
                    </div>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-4">
                  <div>
                    <FormLabel>Enabled</FormLabel>
                    <FormDescription>
                      Enable or disable this notification
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="switch-notification-enabled"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-notification"
              >
                {isEdit ? "Update" : "Create"} Notification
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CredentialProfileDialog({ 
  profile, 
  open, 
  onOpenChange 
}: { 
  profile?: CredentialProfile; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const isEdit = !!profile;

  const form = useForm<CredentialFormData>({
    resolver: zodResolver(credentialFormSchema),
    defaultValues: {
      name: "",
      type: "mikrotik",
      credentials: {
        prometheusMetrics: [],
      },
    },
  });

  useEffect(() => {
    if (open) {
      if (profile) {
        form.reset({
          name: profile.name,
          type: profile.type as "mikrotik" | "snmp" | "prometheus" | "proxmox",
          credentials: {
            ...profile.credentials,
            prometheusMetrics: profile.credentials?.prometheusMetrics || [],
          },
        });
      } else {
        form.reset({
          name: "",
          type: "mikrotik",
          credentials: {
            prometheusMetrics: [],
          },
        });
      }
    }
  }, [open, profile, form]);

  const credentialType = form.watch("type");

  const createMutation = useMutation({
    mutationFn: async (data: InsertCredentialProfile) => 
      apiRequest("POST", "/api/credential-profiles", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credential-profiles"] });
      toast({ description: "Credential profile created successfully" });
      onOpenChange(false);
      form.reset();
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to create credential profile" 
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertCredentialProfile) =>
      apiRequest("PATCH", `/api/credential-profiles/${profile?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credential-profiles"] });
      toast({ description: "Credential profile updated successfully" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update credential profile" 
      });
    },
  });

  const onSubmit = (data: CredentialFormData) => {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-credential-profile">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">
            {isEdit ? "Edit Credential Profile" : "Create Credential Profile"}
          </DialogTitle>
          <DialogDescription>
            {isEdit 
              ? "Update the credential profile. Changes will apply to all devices using this profile." 
              : "Create a reusable credential profile for your devices."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Profile Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="My Router Credentials" data-testid="input-profile-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Device Type</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isEdit}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-credential-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="mikrotik">Mikrotik Device</SelectItem>
                      <SelectItem value="snmp">SNMP Device</SelectItem>
                      <SelectItem value="prometheus">Prometheus (node_exporter)</SelectItem>
                      <SelectItem value="proxmox">Proxmox VE Host</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {credentialType === "mikrotik" && (
              <>
                <div className="space-y-3 p-4 border rounded-md">
                  <h4 className="text-sm font-medium">Mikrotik API Credentials</h4>
                  <p className="text-xs text-muted-foreground">Used for device probing and management</p>
                  
                  <FormField
                    control={form.control}
                    name="credentials.username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="admin" autoComplete="off" data-testid="input-username" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="credentials.password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input {...field} type="password" placeholder="••••••••" autoComplete="new-password" data-testid="input-password" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="credentials.apiPort"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Port</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="number" 
                            placeholder="8728"
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            data-testid="input-api-port"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3 p-4 border rounded-md">
                  <h4 className="text-sm font-medium">SNMP Credentials (Optional)</h4>
                  <p className="text-xs text-muted-foreground">Required for connection traffic monitoring</p>
                  
                  <FormField
                    control={form.control}
                    name="credentials.snmpVersion"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SNMP Version</FormLabel>
                        <Select value={field.value || ""} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-mikrotik-snmp-version">
                              <SelectValue placeholder="Select version (optional)" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="1">SNMP v1</SelectItem>
                            <SelectItem value="2c">SNMP v2c</SelectItem>
                            <SelectItem value="3">SNMP v3</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {(form.watch("credentials.snmpVersion") === "1" || form.watch("credentials.snmpVersion") === "2c") && (
                    <FormField
                      control={form.control}
                      name="credentials.snmpCommunity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Community String</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="public" data-testid="input-mikrotik-snmp-community" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {form.watch("credentials.snmpVersion") === "3" && (
                    <>
                      <FormField
                        control={form.control}
                        name="credentials.snmpUsername"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>SNMPv3 Username</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="snmpuser" autoComplete="off" data-testid="input-mikrotik-snmp-username" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="credentials.snmpAuthProtocol"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Auth Protocol</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-mikrotik-snmp-auth-protocol">
                                    <SelectValue placeholder="Select protocol" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="MD5">MD5</SelectItem>
                                  <SelectItem value="SHA">SHA</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="credentials.snmpAuthKey"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Auth Key</FormLabel>
                              <FormControl>
                                <Input {...field} type="password" placeholder="••••••••" autoComplete="new-password" data-testid="input-mikrotik-snmp-auth-key" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="credentials.snmpPrivProtocol"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Privacy Protocol</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-mikrotik-snmp-priv-protocol">
                                    <SelectValue placeholder="Select protocol" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="DES">DES</SelectItem>
                                  <SelectItem value="AES">AES</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="credentials.snmpPrivKey"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Privacy Key</FormLabel>
                              <FormControl>
                                <Input {...field} type="password" placeholder="••••••••" autoComplete="new-password" data-testid="input-mikrotik-snmp-priv-key" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {credentialType === "snmp" && (
              <>
                <FormField
                  control={form.control}
                  name="credentials.snmpVersion"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SNMP Version</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-snmp-version">
                            <SelectValue placeholder="Select version" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1">SNMP v1</SelectItem>
                          <SelectItem value="2c">SNMP v2c</SelectItem>
                          <SelectItem value="3">SNMP v3</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {(form.watch("credentials.snmpVersion") === "1" || form.watch("credentials.snmpVersion") === "2c") && (
                  <FormField
                    control={form.control}
                    name="credentials.snmpCommunity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Community String</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="public" data-testid="input-snmp-community" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {form.watch("credentials.snmpVersion") === "3" && (
                  <>
                    <FormField
                      control={form.control}
                      name="credentials.snmpUsername"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>SNMPv3 Username</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="snmpuser" autoComplete="off" data-testid="input-snmp-username" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="credentials.snmpAuthProtocol"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Auth Protocol</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger data-testid="select-snmp-auth-protocol">
                                  <SelectValue placeholder="Select protocol" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="MD5">MD5</SelectItem>
                                <SelectItem value="SHA">SHA</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="credentials.snmpAuthKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Auth Key</FormLabel>
                            <FormControl>
                              <Input {...field} type="password" placeholder="••••••••" autoComplete="new-password" data-testid="input-snmp-auth-key" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="credentials.snmpPrivProtocol"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Privacy Protocol</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger data-testid="select-snmp-priv-protocol">
                                  <SelectValue placeholder="Select protocol" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="DES">DES</SelectItem>
                                <SelectItem value="AES">AES</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="credentials.snmpPrivKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Privacy Key</FormLabel>
                            <FormControl>
                              <Input {...field} type="password" placeholder="••••••••" autoComplete="new-password" data-testid="input-snmp-priv-key" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {credentialType === "prometheus" && (
              <>
                <div className="space-y-3 p-4 border rounded-md">
                  <h4 className="text-sm font-medium">Prometheus node_exporter Settings</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Connect to servers running Prometheus node_exporter for system metrics
                  </p>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="credentials.prometheusPort"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Port</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="number" 
                              placeholder="9100" 
                              data-testid="input-prometheus-port" 
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            Default: 9100
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="credentials.prometheusScheme"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Protocol</FormLabel>
                          <Select value={field.value || "http"} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger data-testid="select-prometheus-scheme">
                                <SelectValue placeholder="http" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="http">HTTP</SelectItem>
                              <SelectItem value="https">HTTPS</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="credentials.prometheusPath"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Metrics Path</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="/metrics" 
                            data-testid="input-prometheus-path" 
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Default: /metrics
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-3 p-4 border rounded-md">
                  <h4 className="text-sm font-medium">Extra Metrics to Monitor</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Select additional metrics to collect from node_exporter (CPU, Memory, Disk are always collected)
                  </p>
                  
                  <FormField
                    control={form.control}
                    name="credentials.prometheusMetrics"
                    render={({ field }) => (
                      <FormItem>
                        <div className="grid grid-cols-2 gap-2">
                          {PROMETHEUS_METRIC_PRESETS.map((preset) => {
                            const isChecked = field.value?.some(m => m.id === preset.id) ?? false;
                            return (
                              <div key={preset.id} className="flex items-center space-x-2">
                                <Checkbox
                                  id={`metric-${preset.id}`}
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    const currentMetrics = field.value || [];
                                    if (checked) {
                                      // Clone preset to avoid mutating the original
                                      const clonedPreset = JSON.parse(JSON.stringify(preset));
                                      field.onChange([...currentMetrics, clonedPreset]);
                                    } else {
                                      field.onChange(currentMetrics.filter(m => m.id !== preset.id));
                                    }
                                  }}
                                  data-testid={`checkbox-metric-${preset.id}`}
                                />
                                <label 
                                  htmlFor={`metric-${preset.id}`}
                                  className="text-sm cursor-pointer"
                                >
                                  {preset.label}
                                </label>
                              </div>
                            );
                          })}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            {credentialType === "proxmox" && (
              <>
                <div className="space-y-3 p-4 border rounded-md">
                  <h4 className="text-sm font-medium">Proxmox VE API Credentials</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Connect to Proxmox VE hosts using API tokens (recommended) or username/password
                  </p>
                  
                  <FormField
                    control={form.control}
                    name="credentials.proxmoxApiTokenId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Token ID</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="user@pam!tokenname" 
                            autoComplete="off"
                            data-testid="input-proxmox-token-id" 
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Format: user@realm!tokenname (leave empty to use username/password)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="credentials.proxmoxApiTokenSecret"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Token Secret</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="password" 
                            placeholder="••••••••" 
                            autoComplete="new-password"
                            data-testid="input-proxmox-token-secret" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="border-t pt-3 mt-3">
                    <p className="text-xs text-muted-foreground mb-3">Or use username/password authentication:</p>
                    
                    <FormField
                      control={form.control}
                      name="credentials.username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              placeholder="root" 
                              autoComplete="off"
                              data-testid="input-proxmox-username" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="credentials.password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              type="password" 
                              placeholder="••••••••" 
                              autoComplete="new-password"
                              data-testid="input-proxmox-password" 
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="credentials.proxmoxRealm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Realm</FormLabel>
                          <Select value={field.value || "pam"} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger data-testid="select-proxmox-realm">
                                <SelectValue placeholder="pam" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="pam">PAM (Linux)</SelectItem>
                              <SelectItem value="pve">PVE (Proxmox)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="credentials.proxmoxPort"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>API Port</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            type="number" 
                            placeholder="8006" 
                            value={field.value || ""}
                            onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                            data-testid="input-proxmox-port" 
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Default: 8006
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-profile"
              >
                {isEdit ? "Update" : "Create"} Profile
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const { isAdmin, user } = useAuth();
  const [editingProfile, setEditingProfile] = useState<CredentialProfile | undefined>();
  const [deletingProfile, setDeletingProfile] = useState<CredentialProfile | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNotification, setEditingNotification] = useState<Notification | undefined>();
  const [deletingNotification, setDeletingNotification] = useState<Notification | undefined>();
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false);
  const [pollingInterval, setPollingInterval] = useState("30");
  const [defaultProbeTimeout, setDefaultProbeTimeout] = useState("6");
  const [defaultOfflineThreshold, setDefaultOfflineThreshold] = useState("1");
  const [concurrentProbeThreads, setConcurrentProbeThreads] = useState("80");
  const [mikrotikKeepConnections, setMikrotikKeepConnections] = useState(false);
  const [pingFallbackEnabled, setPingFallbackEnabled] = useState(false);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Only admins can access settings
  if (!isAdmin) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <header className="border-b bg-card">
          <div className="flex items-center gap-4 px-6 py-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Access Restricted
              </p>
            </div>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-destructive" />
                Access Denied
              </CardTitle>
              <CardDescription>
                You don't have permission to access the Settings page.
                Only administrators can modify system settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Your current role: <span className="font-medium capitalize">{user?.role || 'unknown'}</span>
              </p>
              <Link href="/">
                <Button className="w-full" data-testid="button-return-home">
                  Return to Dashboard
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const { data: profiles = [], isLoading } = useQuery<CredentialProfile[]>({
    queryKey: ["/api/credential-profiles"],
  });

  const { data: notifications = [], isLoading: notificationsLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const { data: pollingIntervalData } = useQuery<{ key: string; value: string }>({
    queryKey: ["/api/settings", "polling_interval"],
    queryFn: async () => {
      const response = await fetch("/api/settings/polling_interval");
      if (!response.ok) throw new Error("Failed to fetch polling interval");
      return response.json();
    },
  });

  const { data: defaultProbeTimeoutData } = useQuery<{ key: string; value: number }>({
    queryKey: ["/api/settings", "default_probe_timeout"],
    queryFn: async () => {
      const response = await fetch("/api/settings/default_probe_timeout");
      if (!response.ok) return { key: "default_probe_timeout", value: 6 };
      return response.json();
    },
  });

  const { data: defaultOfflineThresholdData } = useQuery<{ key: string; value: number }>({
    queryKey: ["/api/settings", "default_offline_threshold"],
    queryFn: async () => {
      const response = await fetch("/api/settings/default_offline_threshold");
      if (!response.ok) return { key: "default_offline_threshold", value: 1 };
      return response.json();
    },
  });

  const { data: concurrentProbeThreadsData } = useQuery<{ key: string; value: number }>({
    queryKey: ["/api/settings", "concurrent_probe_threads"],
    queryFn: async () => {
      const response = await fetch("/api/settings/concurrent_probe_threads");
      if (!response.ok) return { key: "concurrent_probe_threads", value: 80 };
      return response.json();
    },
  });

  const { data: mikrotikKeepConnectionsData } = useQuery<{ key: string; value: boolean }>({
    queryKey: ["/api/settings", "mikrotik_keep_connections"],
    queryFn: async () => {
      const response = await fetch("/api/settings/mikrotik_keep_connections");
      if (!response.ok) return { key: "mikrotik_keep_connections", value: false };
      return response.json();
    },
  });

  const { data: pingFallbackEnabledData } = useQuery<{ key: string; value: boolean }>({
    queryKey: ["/api/settings", "ping_fallback_enabled"],
    queryFn: async () => {
      const response = await fetch("/api/settings/ping_fallback_enabled");
      if (!response.ok) return { key: "ping_fallback_enabled", value: false };
      return response.json();
    },
  });

  const { data: timezoneData } = useQuery<{ key: string; value: string }>({
    queryKey: ["/api/settings", "timezone"],
    queryFn: async () => {
      const response = await fetch("/api/settings/timezone");
      if (!response.ok) return { key: "timezone", value: Intl.DateTimeFormat().resolvedOptions().timeZone };
      return response.json();
    },
  });

  // Sync state with fetched data
  useEffect(() => {
    if (pollingIntervalData?.value !== undefined) {
      setPollingInterval(String(pollingIntervalData.value));
    }
  }, [pollingIntervalData]);

  useEffect(() => {
    if (defaultProbeTimeoutData?.value !== undefined) {
      setDefaultProbeTimeout(String(defaultProbeTimeoutData.value));
    }
  }, [defaultProbeTimeoutData]);

  useEffect(() => {
    if (defaultOfflineThresholdData?.value !== undefined) {
      setDefaultOfflineThreshold(String(defaultOfflineThresholdData.value));
    }
  }, [defaultOfflineThresholdData]);

  useEffect(() => {
    if (concurrentProbeThreadsData?.value !== undefined) {
      setConcurrentProbeThreads(String(concurrentProbeThreadsData.value));
    }
  }, [concurrentProbeThreadsData]);

  useEffect(() => {
    if (mikrotikKeepConnectionsData?.value !== undefined) {
      setMikrotikKeepConnections(mikrotikKeepConnectionsData.value);
    }
  }, [mikrotikKeepConnectionsData]);

  useEffect(() => {
    if (pingFallbackEnabledData?.value !== undefined) {
      setPingFallbackEnabled(pingFallbackEnabledData.value);
    }
  }, [pingFallbackEnabledData]);

  useEffect(() => {
    if (timezoneData?.value) {
      setTimezone(timezoneData.value);
    }
  }, [timezoneData]);

  const deleteProfileMutation = useMutation({
    mutationFn: async (id: string) => 
      apiRequest("DELETE", `/api/credential-profiles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/credential-profiles"] });
      toast({ description: "Credential profile deleted successfully" });
      setDeletingProfile(undefined);
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to delete credential profile" 
      });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: async (id: string) => 
      apiRequest("DELETE", `/api/notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ description: "Notification deleted successfully" });
      setDeletingNotification(undefined);
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to delete notification" 
      });
    },
  });

  const updatePollingMutation = useMutation({
    mutationFn: async (value: string) => 
      apiRequest("PUT", `/api/settings/polling_interval`, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", "polling_interval"] });
      toast({ description: "Polling interval updated successfully. Restart the application for changes to take effect." });
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update polling interval" 
      });
    },
  });

  const updateDefaultTimeoutMutation = useMutation({
    mutationFn: async (value: number) => 
      apiRequest("PUT", `/api/settings/default_probe_timeout`, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", "default_probe_timeout"] });
      toast({ description: "Default probe timeout updated successfully" });
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update default probe timeout" 
      });
    },
  });

  const updateDefaultThresholdMutation = useMutation({
    mutationFn: async (value: number) => 
      apiRequest("PUT", `/api/settings/default_offline_threshold`, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", "default_offline_threshold"] });
      toast({ description: "Default offline threshold updated successfully" });
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update default offline threshold" 
      });
    },
  });

  const updateConcurrentThreadsMutation = useMutation({
    mutationFn: async (value: number) => 
      apiRequest("PUT", `/api/settings/concurrent_probe_threads`, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", "concurrent_probe_threads"] });
      toast({ description: "Concurrent probe threads updated successfully" });
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update concurrent probe threads" 
      });
    },
  });

  const updateKeepConnectionsMutation = useMutation({
    mutationFn: async (value: boolean) => 
      apiRequest("PUT", `/api/settings/mikrotik_keep_connections`, { value }),
    onSuccess: (_data, value) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", "mikrotik_keep_connections"] });
      toast({ description: `Mikrotik persistent connections ${value ? 'enabled' : 'disabled'}` });
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update connection setting" 
      });
    },
  });

  const updatePingFallbackMutation = useMutation({
    mutationFn: async (value: boolean) => 
      apiRequest("PUT", `/api/settings/ping_fallback_enabled`, { value }),
    onSuccess: (_data, value) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", "ping_fallback_enabled"] });
      toast({ description: `Ping fallback ${value ? 'enabled' : 'disabled'}` });
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update ping fallback setting" 
      });
    },
  });

  const updateTimezoneMutation = useMutation({
    mutationFn: async (value: string) => 
      apiRequest("PUT", `/api/settings/timezone`, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings", "timezone"] });
      toast({ description: "Timezone updated successfully" });
    },
    onError: () => {
      toast({ 
        variant: "destructive",
        description: "Failed to update timezone" 
      });
    },
  });

  const handleEdit = (profile: CredentialProfile) => {
    setEditingProfile(profile);
    setDialogOpen(true);
  };

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingProfile(undefined);
    }
  };

  const handleEditNotification = (notification: Notification) => {
    setEditingNotification(notification);
    setNotificationDialogOpen(true);
  };

  const handleNotificationDialogClose = (open: boolean) => {
    setNotificationDialogOpen(open);
    if (!open) {
      setEditingNotification(undefined);
    }
  };

  const handleUpdatePolling = () => {
    updatePollingMutation.mutate(pollingInterval);
  };

  const handleUpdateDefaultTimeout = () => {
    const value = parseInt(defaultProbeTimeout);
    if (value >= 1 && value <= 120) {
      updateDefaultTimeoutMutation.mutate(value);
    }
  };

  const handleUpdateDefaultThreshold = () => {
    const value = parseInt(defaultOfflineThreshold);
    if (value >= 1 && value <= 10) {
      updateDefaultThresholdMutation.mutate(value);
    }
  };

  const handleUpdateConcurrentThreads = () => {
    const value = parseInt(concurrentProbeThreads);
    if (value >= 1 && value <= 200) {
      updateConcurrentThreadsMutation.mutate(value);
    }
  };

  const handleToggleKeepConnections = (checked: boolean) => {
    setMikrotikKeepConnections(checked);
    updateKeepConnectionsMutation.mutate(checked);
  };

  const handleTogglePingFallback = (checked: boolean) => {
    setPingFallbackEnabled(checked);
    updatePingFallbackMutation.mutate(checked);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="flex items-center gap-4 px-6 py-4">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage credential profiles and application settings
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <Card data-testid="card-polling-interval">
            <CardHeader>
              <CardTitle>Polling Interval</CardTitle>
              <CardDescription>
                Configure how often devices are automatically probed for status updates
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-4">
                <div className="flex-1 max-w-xs">
                  <Label htmlFor="polling-interval">Interval (seconds)</Label>
                  <Input
                    id="polling-interval"
                    type="number"
                    min="5"
                    max="300"
                    value={pollingInterval}
                    onChange={(e) => setPollingInterval(e.target.value)}
                    placeholder={pollingIntervalData?.value || "30"}
                    data-testid="input-polling-interval"
                  />
                </div>
                <Button 
                  onClick={handleUpdatePolling}
                  disabled={updatePollingMutation.isPending}
                  data-testid="button-save-polling"
                >
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-probing-defaults">
            <CardHeader>
              <CardTitle>Probing Defaults</CardTitle>
              <CardDescription>
                Default settings for device probing. Per-device settings override these values.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-end gap-4">
                <div className="flex-1 max-w-xs">
                  <Label htmlFor="default-probe-timeout">Default Probe Timeout (seconds)</Label>
                  <Input
                    id="default-probe-timeout"
                    type="number"
                    min="1"
                    max="120"
                    value={defaultProbeTimeout}
                    onChange={(e) => setDefaultProbeTimeout(e.target.value)}
                    placeholder={String(defaultProbeTimeoutData?.value || 6)}
                    data-testid="input-default-probe-timeout"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Time to wait for device response (1-120 seconds)
                  </p>
                </div>
                <Button 
                  onClick={handleUpdateDefaultTimeout}
                  disabled={updateDefaultTimeoutMutation.isPending}
                  data-testid="button-save-default-timeout"
                >
                  Save
                </Button>
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1 max-w-xs">
                  <Label htmlFor="default-offline-threshold">Default Offline Threshold (cycles)</Label>
                  <Input
                    id="default-offline-threshold"
                    type="number"
                    min="1"
                    max="10"
                    value={defaultOfflineThreshold}
                    onChange={(e) => setDefaultOfflineThreshold(e.target.value)}
                    placeholder={String(defaultOfflineThresholdData?.value || 1)}
                    data-testid="input-default-offline-threshold"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Failed probe cycles before marking device offline (1-10)
                  </p>
                </div>
                <Button 
                  onClick={handleUpdateDefaultThreshold}
                  disabled={updateDefaultThresholdMutation.isPending}
                  data-testid="button-save-default-threshold"
                >
                  Save
                </Button>
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1 max-w-xs">
                  <Label htmlFor="concurrent-probe-threads">Concurrent Probe Threads</Label>
                  <Input
                    id="concurrent-probe-threads"
                    type="number"
                    min="1"
                    max="200"
                    value={concurrentProbeThreads}
                    onChange={(e) => setConcurrentProbeThreads(e.target.value)}
                    placeholder={String(concurrentProbeThreadsData?.value || 80)}
                    data-testid="input-concurrent-probe-threads"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Number of devices to probe simultaneously (1-200). Lower values may reduce mass failures.
                  </p>
                </div>
                <Button 
                  onClick={handleUpdateConcurrentThreads}
                  disabled={updateConcurrentThreadsMutation.isPending}
                  data-testid="button-save-concurrent-threads"
                >
                  Save
                </Button>
              </div>
              <div className="flex items-center justify-between p-4 border rounded-md">
                <div className="flex-1">
                  <Label htmlFor="mikrotik-keep-connections" className="text-base font-medium">
                    Mikrotik: Keep Connections Open
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Maintain persistent API connections to Mikrotik devices instead of connecting/disconnecting each probe cycle. 
                    Can reduce false positives caused by connection drops.
                  </p>
                </div>
                <Switch
                  id="mikrotik-keep-connections"
                  checked={mikrotikKeepConnections}
                  onCheckedChange={handleToggleKeepConnections}
                  disabled={updateKeepConnectionsMutation.isPending}
                  data-testid="switch-mikrotik-keep-connections"
                />
              </div>
              <div className="flex items-center justify-between p-4 border rounded-md">
                <div className="flex-1">
                  <Label htmlFor="ping-fallback-enabled" className="text-base font-medium">
                    Ping Fallback Verification
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    When API/SNMP probe fails, ping the device before marking offline. If ping succeeds, 
                    mark as "stale" instead of "offline" (no alarm triggered). Useful for detecting when 
                    device is reachable but API is temporarily unavailable.
                  </p>
                </div>
                <Switch
                  id="ping-fallback-enabled"
                  checked={pingFallbackEnabled}
                  onCheckedChange={handleTogglePingFallback}
                  disabled={updatePingFallbackMutation.isPending}
                  data-testid="switch-ping-fallback-enabled"
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1 max-w-xs">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select value={timezone} onValueChange={(value) => {
                    setTimezone(value);
                    updateTimezoneMutation.mutate(value);
                  }}>
                    <SelectTrigger id="timezone" data-testid="select-timezone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="America/New_York">America/New_York (EST)</SelectItem>
                      <SelectItem value="America/Chicago">America/Chicago (CST)</SelectItem>
                      <SelectItem value="America/Denver">America/Denver (MST)</SelectItem>
                      <SelectItem value="America/Los_Angeles">America/Los_Angeles (PST)</SelectItem>
                      <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                      <SelectItem value="Europe/Paris">Europe/Paris (CET)</SelectItem>
                      <SelectItem value="Europe/Berlin">Europe/Berlin (CET)</SelectItem>
                      <SelectItem value="Europe/Amsterdam">Europe/Amsterdam (CET)</SelectItem>
                      <SelectItem value="Europe/Stockholm">Europe/Stockholm (CET)</SelectItem>
                      <SelectItem value="Asia/Tokyo">Asia/Tokyo (JST)</SelectItem>
                      <SelectItem value="Asia/Shanghai">Asia/Shanghai (CST)</SelectItem>
                      <SelectItem value="Asia/Hong_Kong">Asia/Hong_Kong (HKT)</SelectItem>
                      <SelectItem value="Asia/Singapore">Asia/Singapore (SGT)</SelectItem>
                      <SelectItem value="Asia/Bangkok">Asia/Bangkok (ICT)</SelectItem>
                      <SelectItem value="Australia/Sydney">Australia/Sydney (AEDT)</SelectItem>
                      <SelectItem value="Australia/Melbourne">Australia/Melbourne (AEDT)</SelectItem>
                      <SelectItem value="Australia/Brisbane">Australia/Brisbane (AEST)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Timezone for displaying logs and timestamps
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-credential-profiles">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
              <div>
                <CardTitle>Credential Profiles</CardTitle>
                <CardDescription>
                  Create reusable credential profiles for your network devices
                </CardDescription>
              </div>
              <Button 
                onClick={() => {
                  setEditingProfile(undefined);
                  setDialogOpen(true);
                }}
                data-testid="button-add-profile"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Profile
              </Button>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading profiles...
                </div>
              ) : profiles.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No credential profiles yet. Create one to get started.
                </div>
              ) : (
                <div className="space-y-2">
                  {profiles.map((profile) => (
                    <div 
                      key={profile.id}
                      className="flex items-center justify-between p-4 border rounded-md hover-elevate"
                      data-testid={`profile-item-${profile.id}`}
                    >
                      <div>
                        <div className="font-medium text-foreground" data-testid={`text-profile-name-${profile.id}`}>
                          {profile.name}
                        </div>
                        <div className="text-sm text-muted-foreground" data-testid={`text-profile-type-${profile.id}`}>
                          {profile.type === "mikrotik" ? "Mikrotik Device" : 
                           profile.type === "proxmox" ? "Proxmox Device" : 
                           profile.type === "prometheus" ? "Prometheus (node_exporter)" : 
                           "SNMP Device"}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handleEdit(profile)}
                          data-testid={`button-edit-${profile.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => setDeletingProfile(profile)}
                          data-testid={`button-delete-${profile.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-notifications">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
              <div>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>
                  Configure notification endpoints for device status alerts
                </CardDescription>
              </div>
              <Button 
                onClick={() => {
                  setEditingNotification(undefined);
                  setNotificationDialogOpen(true);
                }}
                data-testid="button-add-notification"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Notification
              </Button>
            </CardHeader>
            <CardContent>
              {notificationsLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading notifications...
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No notifications configured yet. Create one to get started.
                </div>
              ) : (
                <div className="space-y-2">
                  {notifications.map((notification) => (
                    <div 
                      key={notification.id}
                      className="flex items-center justify-between p-4 border rounded-md hover-elevate"
                      data-testid={`notification-item-${notification.id}`}
                    >
                      <div className="flex items-center gap-3">
                        {notification.enabled ? (
                          <Bell className="h-5 w-5 text-primary" />
                        ) : (
                          <BellOff className="h-5 w-5 text-muted-foreground" />
                        )}
                        <div>
                          <div className="font-medium text-foreground" data-testid={`text-notification-name-${notification.id}`}>
                            {notification.name}
                          </div>
                          <div className="text-sm text-muted-foreground" data-testid={`text-notification-url-${notification.id}`}>
                            {notification.type === 'telegram' && 'Telegram'}
                            {notification.type === 'slack' && 'Slack'}
                            {notification.type === 'pushover' && 'Pushover'}
                            {notification.type === 'email' && 'Email'}
                            {(notification.type === 'webhook' || !notification.type) && `${notification.method} ${notification.url}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handleEditNotification(notification)}
                          data-testid={`button-edit-notification-${notification.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => setDeletingNotification(notification)}
                          data-testid={`button-delete-notification-${notification.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <BackupSection />

          <MetricsHistorySection />

          <OnDutyScheduleSection />

          <UserManagementSection />

          <LicenseSection />

          <DangerZoneSection />

          <VersionSection />
        </div>
      </main>

      <NotificationDialog 
        notification={editingNotification}
        open={notificationDialogOpen}
        onOpenChange={handleNotificationDialogClose}
      />

      <CredentialProfileDialog 
        profile={editingProfile}
        open={dialogOpen}
        onOpenChange={handleDialogClose}
      />

      <AlertDialog open={!!deletingProfile} onOpenChange={(open) => !open && setDeletingProfile(undefined)}>
        <AlertDialogContent data-testid="dialog-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingProfile?.name}"? Devices using this profile will lose their credentials.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingProfile && deleteProfileMutation.mutate(deletingProfile.id)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingNotification} onOpenChange={(open) => !open && setDeletingNotification(undefined)}>
        <AlertDialogContent data-testid="dialog-delete-notification-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Notification</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingNotification?.name}"? This will remove all device assignments for this notification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-notification">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingNotification && deleteNotificationMutation.mutate(deletingNotification.id)}
              data-testid="button-confirm-delete-notification"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
