import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path, { resolve } from 'node:path';

export type ContainerRuntime = 'docker' | 'podman';

export interface ContainerRuntimeInfo {
  runtime: ContainerRuntime;
  /** Resolved executable; may be an absolute path when the runtime CLI is not on PATH */
  bin: string;
}

function clientVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ['version', '--format', '{{.Client.Version}}'], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim() || null);
    });
  });
}

/** Known install locations probed when the CLI is not on PATH (the MCP host process often has a stale PATH) */
function knownLocations(runtime: ContainerRuntime): string[] {
  const home = homedir();
  if (runtime === 'docker') {
    // OrbStack installs its CLI links into ~/.orbstack/bin on first app launch
    return [path.join(home, '.orbstack', 'bin', 'docker'), '/usr/local/bin/docker', '/opt/homebrew/bin/docker'];
  }
  return ['/usr/local/bin/podman', '/opt/homebrew/bin/podman'];
}

/** Detect an available container runtime: docker first, podman as a CLI-compatible fallback */
export async function detectContainerRuntime(): Promise<ContainerRuntimeInfo | null> {
  for (const runtime of ['docker', 'podman'] as const) {
    if (await clientVersion(runtime)) return { runtime, bin: runtime };
    for (const candidate of knownLocations(runtime)) {
      if (existsSync(candidate) && (await clientVersion(candidate))) {
        return { runtime, bin: candidate };
      }
    }
  }
  return null;
}

/**
 * Verify the container engine daemon is actually reachable (`docker info` fails fast when the
 * engine is stopped — e.g. colima not started, OrbStack app closed — while a bare CLI presence
 * check like `version --format {{.Client.Version}}` succeeds without the daemon).
 */
export function checkContainerDaemon(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['info', '--format', '{{.ServerVersion}}'], { timeout: 10_000 }, (err) => {
      resolve(!err);
    });
  });
}

/** Build the docker/podman run argv for an isolated terminal_open run (cwd mounted at /workspace) */
export function containerSpawn(
  runtimeBin: string,
  command: string,
  args: string[] | undefined,
  opts: { image: string; cwd?: string; env?: Record<string, string>; volumes?: string[] },
): [string, string[]] {
  return [
    runtimeBin,
    [
      'run',
      '--rm',
      '-it',
      ...(opts.cwd ? ['-v', `${resolve(opts.cwd)}:/workspace`, '-w', '/workspace'] : []),
      ...(opts.volumes ?? []).map((v) => ['-v', v]).flat(),
      '-e',
      'TERM=xterm-256color',
      '-e',
      'COLORTERM=truecolor',
      '-e',
      'FORCE_COLOR=1',
      ...Object.entries(opts.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      opts.image,
      command,
      ...(args ?? []),
    ],
  ];
}
