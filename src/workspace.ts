import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  cpSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { Workspace, GitWorkspace } from "./types.js";
import type { BridgeConfig } from "./config.js";

const exec = promisify(execCb);

// ---------------------------------------------------------------------------
// Workspace result
// ---------------------------------------------------------------------------

export interface WorkspaceResult {
  cwd: string;
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Repo slug — extract owner/repo from various URL formats
// ---------------------------------------------------------------------------

export function repoSlug(repo: string): string {
  const match = repo.match(/(?:github\.com\/)?([^/]+\/[^/.]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Invalid repository: ${repo}`);
  return match[1]!.replace("/", "--");
}

// ---------------------------------------------------------------------------
// Git workspace operations
// ---------------------------------------------------------------------------

async function ensureBareClone(repo: string, reposDir: string): Promise<string> {
  const slug = repoSlug(repo);
  const barePath = join(reposDir, slug + ".git");

  mkdirSync(reposDir, { recursive: true });

  const repoUrl = repo.includes("github.com")
    ? repo
    : `https://github.com/${repo}.git`;

  if (existsSync(barePath)) {
    console.log(`[Workspace] Fetching latest for ${slug}...`);
    await exec("git fetch origin '+refs/heads/*:refs/heads/*' --prune", { cwd: barePath });
  } else {
    console.log(`[Workspace] Cloning ${repoUrl} (bare)...`);
    await exec(`git clone --bare ${repoUrl} ${barePath}`);
  }

  return barePath;
}

async function createWorktree(
  barePath: string,
  worktreesDir: string,
  branch = "main",
): Promise<{ worktreePath: string; cleanup: () => Promise<void> }> {
  const id = Date.now().toString(36);
  const worktreePath = join(worktreesDir, `wt-${id}`);

  mkdirSync(worktreesDir, { recursive: true });

  console.log(
    `[Workspace] Creating worktree at ${worktreePath} (branch: ${branch})...`,
  );

  // Prune stale worktree entries before creating new ones
  await exec("git worktree prune", { cwd: barePath });

  // Try the branch as-is first (detached); if it doesn't exist, fall back to main (detached)
  // Always detached to avoid "already checked out" conflicts with stale worktrees
  try {
    await exec(`git worktree add --detach ${worktreePath} ${branch}`, {
      cwd: barePath,
    });
  } catch {
    console.log(
      `[Workspace] Branch "${branch}" not found, creating from main (detached)...`,
    );
    await exec(`git worktree add --detach ${worktreePath} main`, {
      cwd: barePath,
    });
  }

  const cleanup = async () => {
    console.log(`[Workspace] Cleaning up worktree ${worktreePath}...`);
    try {
      await exec(`git worktree remove --force ${worktreePath}`, {
        cwd: barePath,
      });
    } catch {
      rmSync(worktreePath, { recursive: true, force: true });
      await exec("git worktree prune", { cwd: barePath });
    }
  };

  return { worktreePath, cleanup };
}

function injectOverlays(worktreePath: string, repo: string, overlaysDir: string): void {
  const slug = repoSlug(repo);
  const overlayDir = join(overlaysDir, slug);

  if (!existsSync(overlayDir)) {
    console.log(`[Workspace] No overlays found for ${slug}`);
    return;
  }

  console.log(`[Workspace] Injecting overlays from ${overlayDir}...`);
  for (const entry of readdirSync(overlayDir)) {
    cpSync(join(overlayDir, entry), join(worktreePath, entry), {
      recursive: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Setup workspace based on strategy
// ---------------------------------------------------------------------------

export async function setupWorkspace(
  workspace: Workspace | undefined,
  config: BridgeConfig,
): Promise<WorkspaceResult> {
  if (!workspace) {
    // No workspace — run in current directory
    return { cwd: process.cwd(), cleanup: async () => {} };
  }

  if (workspace.type === "git") {
    const barePath = await ensureBareClone(workspace.repo, config.reposDir);
    const wt = await createWorktree(barePath, config.worktreesDir, workspace.branch);

    if (workspace.overlays !== false) {
      injectOverlays(wt.worktreePath, workspace.repo, config.overlaysDir);
    }

    // Configure git identity
    await exec(`git config user.name "Agent Bridge"`, { cwd: wt.worktreePath });
    await exec(`git config user.email "bridge@agent-bridge.local"`, { cwd: wt.worktreePath });

    return { cwd: wt.worktreePath, cleanup: wt.cleanup };
  }

  if (workspace.type === "tempdir") {
    const dir = mkdtempSync(join(tmpdir(), "bridge-"));
    console.log(`[Workspace] Created tempdir: ${dir}`);

    // Seed files if provided
    if (workspace.seedFiles) {
      for (const [filePath, content] of Object.entries(workspace.seedFiles)) {
        const fullPath = join(dir, filePath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content);
      }
      console.log(`[Workspace] Seeded ${Object.keys(workspace.seedFiles).length} file(s)`);
    }

    return {
      cwd: dir,
      cleanup: async () => {
        console.log(`[Workspace] Cleaning up tempdir ${dir}...`);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  throw new Error(`Unsupported workspace type: ${(workspace as { type: string }).type}`);
}

// ---------------------------------------------------------------------------
// Load MCP servers from .mcp.json in workspace
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadMcpServers(cwd: string): Record<string, any> {
  const mcpPath = join(cwd, ".mcp.json");
  if (!existsSync(mcpPath)) return {};

  const raw = JSON.parse(readFileSync(mcpPath, "utf-8"));
  return raw.mcpServers ?? {};
}

// ---------------------------------------------------------------------------
// Git push verification — detect phantom completions
// ---------------------------------------------------------------------------

export async function verifyGitPush(
  cwd: string,
  branch: string,
): Promise<{ pushed: boolean; unpushedCommits: string[] }> {
  try {
    // Check if there are local commits not on the remote
    const { stdout: logOutput } = await exec(
      `git log --oneline origin/${branch}..HEAD 2>/dev/null || echo ""`,
      { cwd },
    );
    const unpushedCommits = logOutput
      .trim()
      .split("\n")
      .filter(Boolean);

    if (unpushedCommits.length > 0) {
      console.warn(
        `[Verify] Branch "${branch}" has ${unpushedCommits.length} unpushed commit(s):\n${unpushedCommits.map((c) => `  ${c}`).join("\n")}`,
      );
      return { pushed: false, unpushedCommits };
    }

    // Also verify the branch actually exists on the remote
    const { stdout: remoteRef } = await exec(
      `git ls-remote --heads origin ${branch}`,
      { cwd },
    );
    if (!remoteRef.trim()) {
      console.warn(`[Verify] Branch "${branch}" does not exist on remote`);
      return { pushed: false, unpushedCommits: ["(branch not on remote)"] };
    }

    console.log(`[Verify] Branch "${branch}" verified on remote`);
    return { pushed: true, unpushedCommits: [] };
  } catch (err) {
    console.warn(
      `[Verify] Git push verification failed:`,
      err instanceof Error ? err.message : err,
    );
    return { pushed: false, unpushedCommits: ["(verification error)"] };
  }
}
