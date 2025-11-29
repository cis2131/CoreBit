import { createContext, useContext, useCallback, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type UserRole = "admin" | "superuser" | "viewer";

export interface User {
  id: string;
  username: string;
  role: UserRole;
  displayName?: string | null;
  lastLogin?: string | null;
  createdAt?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isSuperuserOrAdmin: boolean;
  canModify: boolean;
  refetchUser: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  
  const { data: sessionData, isLoading, refetch } = useQuery<{ user: User } | null>({
    queryKey: ["/api/auth/session"],
    queryFn: async () => {
      const res = await fetch("/api/auth/session", {
        credentials: "include",
      });
      if (res.status === 401) {
        return null;
      }
      if (!res.ok) {
        throw new Error("Failed to fetch session");
      }
      return res.json();
    },
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const user = sessionData?.user ?? null;
  const isAuthenticated = !!user;
  const isAdmin = user?.role === "admin";
  const isSuperuserOrAdmin = user?.role === "admin" || user?.role === "superuser";
  const canModify = isSuperuserOrAdmin;

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      return await apiRequest("POST", "/api/auth/login", { username, password });
    },
    onSuccess: (data) => {
      // Directly set the session data from login response
      // This allows immediate UI update regardless of cookie state
      queryClient.setQueryData(["/api/auth/session"], data);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/session"], null);
      queryClient.invalidateQueries();
    },
  });

  const login = useCallback(async (username: string, password: string) => {
    await loginMutation.mutateAsync({ username, password });
  }, [loginMutation]);

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const refetchUser = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        login,
        logout,
        isAdmin,
        isSuperuserOrAdmin,
        canModify,
        refetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
