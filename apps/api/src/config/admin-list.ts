import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

export interface AdminListItem {
  id: string;
}

export interface AdminList {
  items: AdminListItem[];
}

function getAdminListPath(projectRoot: string): string {
  return resolve(
    projectRoot,
    "data/cluster/DoNotStarveTogether/Cluster/adminlist.txt"
  );
}

export function normalizeKleiId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  const normalized = trimmed.replace(/^ku_/i, "KU_");
  return /^KU_[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
}

function parseAdminList(text: string): AdminListItem[] {
  const ids = text
    .split(/\r?\n/)
    .map((line) => normalizeKleiId(line))
    .filter((id): id is string => id !== null);

  return Array.from(new Set(ids)).map((id) => ({ id }));
}

async function writeAdmins(projectRoot: string, items: AdminListItem[]): Promise<void> {
  const filePath = getAdminListPath(projectRoot);
  const content = items.map((item) => item.id).join("\n");
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content ? `${content}\n` : "");
}

export async function listAdmins(projectRoot: string): Promise<AdminList> {
  try {
    return {
      items: parseAdminList(await fs.readFile(getAdminListPath(projectRoot), "utf8"))
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { items: [] };
    }

    throw error;
  }
}

export async function addAdmin(projectRoot: string, input: unknown): Promise<void> {
  const id = normalizeKleiId(input);
  if (!id) {
    throw new Error("Invalid Klei ID");
  }

  const current = await listAdmins(projectRoot);
  if (current.items.some((item) => item.id === id)) {
    return;
  }

  await writeAdmins(projectRoot, [...current.items, { id }]);
}

export async function deleteAdmin(projectRoot: string, input: unknown): Promise<void> {
  const id = normalizeKleiId(input);
  if (!id) {
    throw new Error("Invalid Klei ID");
  }

  const current = await listAdmins(projectRoot);
  await writeAdmins(
    projectRoot,
    current.items.filter((item) => item.id !== id)
  );
}
