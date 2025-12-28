import { spawn } from 'child_process';
import { storage } from './storage';
import type { PingTarget, InsertPingHistory } from '@shared/schema';

interface FpingResult {
  ip: string;
  sent: number;
  received: number;
  lossPct: number;
  rttValues: number[];
  rttMin: number | null;
  rttMax: number | null;
  rttAvg: number | null;
  rttMdev: number | null;
}

interface PingProbeConfig {
  intervalSeconds: number;
  probeCount: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: PingProbeConfig = {
  intervalSeconds: 30,
  probeCount: 20,
  timeoutMs: 1000,
};

let probeInterval: NodeJS.Timeout | null = null;
let isProbing = false;

function percentile(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function standardDeviation(arr: number[], mean: number): number | null {
  if (arr.length < 2) return null;
  const squareDiffs = arr.map(value => Math.pow(value - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(avgSquareDiff);
}

async function runFping(targets: PingTarget[], config: PingProbeConfig): Promise<Map<string, FpingResult>> {
  const results = new Map<string, FpingResult>();
  
  if (targets.length === 0) return results;

  const ips = targets.map(t => t.ipAddress);
  
  return new Promise((resolve) => {
    const args = [
      '-C', config.probeCount.toString(),
      '-q',
      '-t', config.timeoutMs.toString(),
      '-p', '50',
      ...ips
    ];

    const fping = spawn('fping', args);
    let stderr = '';

    fping.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    fping.on('close', (code) => {
      const lines = stderr.trim().split('\n').filter(line => line.length > 0);
      
      for (const line of lines) {
        const match = line.match(/^(\S+)\s*:\s*(.+)$/);
        if (!match) continue;
        
        const ip = match[1];
        const valuesStr = match[2];
        const values = valuesStr.split(/\s+/).map(v => v.trim());
        
        const rttValues: number[] = [];
        let sent = 0;
        let received = 0;
        
        for (const v of values) {
          sent++;
          if (v !== '-') {
            const rtt = parseFloat(v);
            if (!isNaN(rtt)) {
              rttValues.push(rtt);
              received++;
            }
          }
        }
        
        const lossPct = sent > 0 ? ((sent - received) / sent) * 100 : 100;
        
        let rttMin: number | null = null;
        let rttMax: number | null = null;
        let rttAvg: number | null = null;
        let rttMdev: number | null = null;
        
        if (rttValues.length > 0) {
          rttMin = Math.min(...rttValues);
          rttMax = Math.max(...rttValues);
          rttAvg = rttValues.reduce((a, b) => a + b, 0) / rttValues.length;
          rttMdev = standardDeviation(rttValues, rttAvg);
        }
        
        results.set(ip, {
          ip,
          sent,
          received,
          lossPct,
          rttValues,
          rttMin,
          rttMax,
          rttAvg,
          rttMdev,
        });
      }
      
      for (const ip of ips) {
        if (!results.has(ip)) {
          results.set(ip, {
            ip,
            sent: config.probeCount,
            received: 0,
            lossPct: 100,
            rttValues: [],
            rttMin: null,
            rttMax: null,
            rttAvg: null,
            rttMdev: null,
          });
        }
      }
      
      resolve(results);
    });

    fping.on('error', (error) => {
      console.error('[PingProbe] fping spawn error:', error.message);
      for (const ip of ips) {
        results.set(ip, {
          ip,
          sent: 0,
          received: 0,
          lossPct: 100,
          rttValues: [],
          rttMin: null,
          rttMax: null,
          rttAvg: null,
          rttMdev: null,
        });
      }
      resolve(results);
    });

    setTimeout(() => {
      fping.kill('SIGTERM');
    }, config.timeoutMs * config.probeCount + 5000);
  });
}

async function runProbeCycle(): Promise<void> {
  if (isProbing) {
    console.log('[PingProbe] Previous probe cycle still running, skipping');
    return;
  }
  
  isProbing = true;
  const startTime = Date.now();
  
  try {
    const targets = await storage.getEnabledPingTargets();
    
    if (targets.length === 0) {
      return;
    }
    
    const maxProbeCount = Math.max(...targets.map(t => t.probeCount));
    const config: PingProbeConfig = {
      ...DEFAULT_CONFIG,
      probeCount: maxProbeCount,
    };
    
    const results = await runFping(targets, config);
    
    const historyRecords: InsertPingHistory[] = [];
    const timestamp = new Date();
    
    for (const target of targets) {
      const result = results.get(target.ipAddress);
      if (!result) continue;
      
      const rttValues = result.rttValues;
      
      historyRecords.push({
        targetId: target.id,
        timestamp,
        sent: result.sent,
        received: result.received,
        lossPct: result.lossPct,
        rttMin: result.rttMin,
        rttMax: result.rttMax,
        rttAvg: result.rttAvg,
        rttMdev: result.rttMdev,
        rttP10: percentile(rttValues, 10),
        rttP25: percentile(rttValues, 25),
        rttP50: percentile(rttValues, 50),
        rttP75: percentile(rttValues, 75),
        rttP90: percentile(rttValues, 90),
        rttP95: percentile(rttValues, 95),
      });
    }
    
    if (historyRecords.length > 0) {
      const inserted = await storage.insertPingHistoryBatch(historyRecords);
      const elapsed = Date.now() - startTime;
      console.log(`[PingProbe] Cycle complete: ${targets.length} targets, ${inserted} records stored in ${elapsed}ms`);
    }
    
  } catch (error: any) {
    console.error('[PingProbe] Probe cycle error:', error.message);
  } finally {
    isProbing = false;
  }
}

export async function startPingProbing(intervalSeconds: number = 30): Promise<void> {
  if (probeInterval) {
    console.log('[PingProbe] Already running, restarting with new interval');
    stopPingProbing();
  }
  
  console.log(`[PingProbe] Starting with ${intervalSeconds}s interval`);
  
  await runProbeCycle();
  
  probeInterval = setInterval(() => {
    runProbeCycle();
  }, intervalSeconds * 1000);
}

export function stopPingProbing(): void {
  if (probeInterval) {
    clearInterval(probeInterval);
    probeInterval = null;
    console.log('[PingProbe] Stopped');
  }
}

export async function cleanupOldPingHistory(retentionHours: number = 24): Promise<void> {
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
  const deleted = await storage.deleteOldPingHistory(cutoff);
  if (deleted > 0) {
    console.log(`[PingProbe] Cleaned up ${deleted} old ping history records`);
  }
}

export function getProbingStatus(): { running: boolean; lastProbeTime: Date | null } {
  return {
    running: probeInterval !== null,
    lastProbeTime: null,
  };
}
