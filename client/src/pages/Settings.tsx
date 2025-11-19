import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Trash2, Edit, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { z } from "zod";
import type { CredentialProfile, InsertCredentialProfile } from "@shared/schema";

const credentialFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["mikrotik", "snmp"]),
  credentials: z.object({
    username: z.string().optional(),
    password: z.string().optional(),
    apiPort: z.number().optional(),
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
    defaultValues: profile ? {
      name: profile.name,
      type: profile.type as "mikrotik" | "snmp",
      credentials: profile.credentials,
    } : {
      name: "",
      type: "mikrotik",
      credentials: {},
    },
  });

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
  const [pollingInterval, setPollingInterval] = useState("30");

  const { data: profiles = [], isLoading } = useQuery<CredentialProfile[]>({
    queryKey: ["/api/credential-profiles"],
  });

  const { data: pollingIntervalData } = useQuery<{ key: string; value: string }>({
    queryKey: ["/api/settings", "polling_interval"],
    queryFn: async () => {
      const response = await fetch("/api/settings/polling_interval");
      if (!response.ok) throw new Error("Failed to fetch polling interval");
      return response.json();
    },
  });

  const deleteMutation = useMutation({
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
        </div>
      </main>

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
              onClick={() => deletingProfile && deleteMutation.mutate(deletingProfile.id)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
