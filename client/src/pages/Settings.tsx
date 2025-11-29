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
import { Plus, Trash2, Edit, ArrowLeft, Bell, BellOff, Download, Upload, Clock, HardDrive, RefreshCw, Users, Crown, Shield, Eye, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { z } from "zod";
import type { CredentialProfile, InsertCredentialProfile, Notification, InsertNotification, Backup } from "@shared/schema";

const credentialFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["mikrotik", "snmp"]),
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
  }),
});

type CredentialFormData = z.infer<typeof credentialFormSchema>;

const notificationFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  url: z.string().url("Must be a valid URL"),
  method: z.enum(["GET", "POST"]),
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

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
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

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
    enabled: isAdmin,
  });

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
      url: "",
      method: "POST",
      messageTemplate: "Device [Device.Name] ([Device.Address]) changed status: [Status.Old] → [Status.New]",
      enabled: true,
    },
  });

  useEffect(() => {
    if (notification) {
      form.reset({
        name: notification.name,
        url: notification.url,
        method: notification.method as "GET" | "POST",
        messageTemplate: notification.messageTemplate,
        enabled: notification.enabled,
      });
    } else {
      form.reset({
        name: "",
        url: "",
        method: "POST",
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
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
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
                    <Input {...field} placeholder="Telegram Alert" data-testid="input-notification-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Endpoint URL</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="https://api.telegram.org/bot..." data-testid="input-notification-url" />
                  </FormControl>
                  <FormDescription className="space-y-1">
                    <div>
                      <strong>For GET:</strong> End URL with parameter name and = (e.g., <code className="text-xs">...?text=</code>)
                    </div>
                    <div>
                      <strong>For POST:</strong> Message sent as request body. Add other parameters to URL as needed.
                    </div>
                    <div className="text-xs mt-1">
                      Example: <code>https://api.telegram.org/botTOKEN/sendMessage?chat_id=12345&text=</code>
                    </div>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>HTTP Method</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
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
                    <div className="font-mono text-xs space-x-2">
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
      credentials: {},
    },
  });

  useEffect(() => {
    if (open) {
      if (profile) {
        form.reset({
          name: profile.name,
          type: profile.type as "mikrotik" | "snmp",
          credentials: profile.credentials || {},
        });
      } else {
        form.reset({
          name: "",
          type: "mikrotik",
          credentials: {},
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
                          <Input {...field} placeholder="admin" data-testid="input-username" />
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
                          <Input {...field} type="password" placeholder="••••••••" data-testid="input-password" />
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
                              <Input {...field} placeholder="snmpuser" data-testid="input-mikrotik-snmp-username" />
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
                                <Input {...field} type="password" placeholder="••••••••" data-testid="input-mikrotik-snmp-auth-key" />
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
                                <Input {...field} type="password" placeholder="••••••••" data-testid="input-mikrotik-snmp-priv-key" />
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
                            <Input {...field} placeholder="snmpuser" data-testid="input-snmp-username" />
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
                              <Input {...field} type="password" placeholder="••••••••" data-testid="input-snmp-auth-key" />
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
                              <Input {...field} type="password" placeholder="••••••••" data-testid="input-snmp-priv-key" />
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
  const [editingProfile, setEditingProfile] = useState<CredentialProfile | undefined>();
  const [deletingProfile, setDeletingProfile] = useState<CredentialProfile | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNotification, setEditingNotification] = useState<Notification | undefined>();
  const [deletingNotification, setDeletingNotification] = useState<Notification | undefined>();
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false);
  const [pollingInterval, setPollingInterval] = useState("30");

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
                          {profile.type === "mikrotik" ? "Mikrotik Device" : "SNMP Device"}
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
                            {notification.method} {notification.url}
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

          <UserManagementSection />
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
