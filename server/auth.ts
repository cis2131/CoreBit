import bcrypt from 'bcrypt';
import session from 'express-session';
import { Express, Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import type { User, UserRole } from '@shared/schema';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    username: string;
    role: UserRole;
  }
}

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function setupSession(app: Express): void {
  const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
  const isProduction = process.env.NODE_ENV === 'production';
  
  console.log(`[Auth] Setting up session (production: ${isProduction})`);
  
  // Trust proxy in production (Replit runs behind a proxy)
  if (isProduction) {
    app.set('trust proxy', 1);
    console.log('[Auth] Trust proxy enabled');
  }
  
  const PgSession = connectPgSimple(session);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const sessionConfig = {
    store: new PgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    name: 'corebit.sid',
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax' as const,
      path: '/',
    },
  };
  
  console.log('[Auth] Session cookie config:', {
    secure: sessionConfig.cookie.secure,
    sameSite: sessionConfig.cookie.sameSite,
    httpOnly: sessionConfig.cookie.httpOnly,
    path: sessionConfig.cookie.path,
  });

  app.use(session(sessionConfig));
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: UserRole;
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const userId = req.session?.userId;
  const username = req.session?.username;
  const role = req.session?.role;
  
  if (!userId || !username || !role) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  
  req.user = { id: userId, username, role };
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const userId = req.session?.userId;
    const username = req.session?.username;
    const role = req.session?.role;
    
    if (!userId || !username || !role) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    
    if (!allowedRoles.includes(role)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    
    req.user = { id: userId, username, role };
    next();
  };
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return requireRole('admin')(req, res, next);
}

export function requireSuperuserOrAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return requireRole('admin', 'superuser')(req, res, next);
}

export function canModify(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  return requireRole('admin', 'superuser')(req, res, next);
}

export async function seedDefaultAdmin(): Promise<void> {
  const existingAdmin = await storage.getUserByUsername('admin');
  if (!existingAdmin) {
    const passwordHash = await hashPassword('admin');
    await storage.createUser({
      username: 'admin',
      passwordHash,
      role: 'admin',
      displayName: 'Administrator',
    });
    console.log('[Auth] Created default admin user (admin/admin)');
  } else if (!existingAdmin.role || existingAdmin.role !== 'admin') {
    // Fix admin user role if missing or incorrect
    await storage.updateUser(existingAdmin.id, { role: 'admin' });
    console.log('[Auth] Fixed admin user role');
  }
}

/**
 * Disaster recovery: Reset admin password when ADMIN_RECOVERY_SECRET is set
 * 
 * Usage:
 * 1. Set ADMIN_RECOVERY_SECRET=<your-secret> in .env
 * 2. Optionally set ADMIN_RECOVERY_PASSWORD=<new-password> for a specific password
 * 3. Restart the application
 * 4. Check console logs for the new password (if not set explicitly)
 * 5. Log in with the new password
 * 6. IMPORTANT: Remove ADMIN_RECOVERY_SECRET from .env and restart
 * 
 * If ADMIN_RECOVERY_PASSWORD is not set, a random 16-character password is generated.
 */
export async function checkAdminRecovery(): Promise<void> {
  const recoverySecret = process.env.ADMIN_RECOVERY_SECRET;
  
  if (!recoverySecret) {
    return; // No recovery requested
  }
  
  // Require at least 8 character secret to prevent accidental triggers
  if (recoverySecret.length < 8) {
    console.warn('[Recovery] ADMIN_RECOVERY_SECRET must be at least 8 characters. Skipping recovery.');
    return;
  }
  
  console.log('[Recovery] ========================================');
  console.log('[Recovery] ADMIN PASSWORD RECOVERY INITIATED');
  console.log('[Recovery] ========================================');
  
  try {
    const admin = await storage.getUserByUsername('admin');
    
    if (!admin) {
      // Create admin if doesn't exist
      const newPassword = process.env.ADMIN_RECOVERY_PASSWORD || generateRandomPassword();
      const passwordHash = await hashPassword(newPassword);
      
      await storage.createUser({
        username: 'admin',
        passwordHash,
        role: 'admin',
        displayName: 'Administrator',
      });
      
      console.log('[Recovery] Created new admin user');
      console.log('[Recovery] Username: admin');
      console.log(`[Recovery] Password: ${newPassword}`);
    } else {
      // Reset existing admin password
      const newPassword = process.env.ADMIN_RECOVERY_PASSWORD || generateRandomPassword();
      const passwordHash = await hashPassword(newPassword);
      
      await storage.updateUser(admin.id, { passwordHash });
      
      console.log('[Recovery] Admin password has been reset');
      console.log('[Recovery] Username: admin');
      console.log(`[Recovery] Password: ${newPassword}`);
    }
    
    console.log('[Recovery] ========================================');
    console.log('[Recovery] IMPORTANT: Remove ADMIN_RECOVERY_SECRET');
    console.log('[Recovery] from your .env file and restart the app!');
    console.log('[Recovery] ========================================');
    
  } catch (error) {
    console.error('[Recovery] Failed to reset admin password:', error);
  }
}

function generateRandomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

export function getUserSafeData(user: User): Omit<User, 'passwordHash'> {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}
