import { z } from "zod";

export const serverConfigSchema = z.object({
  steamToken: z.string().min(1),
  clusterName: z.string().min(1),
  clusterPassword: z.string(),
  maxPlayers: z.number().int().min(1).max(64),
  gameMode: z.enum(["survival", "endless", "wilderness"]),
  enableCaves: z.boolean(),
  masterPort: z.number().int().min(1024).max(65535),
  cavesPort: z.number().int().min(1024).max(65535)
});

export type ServerConfigInput = z.infer<typeof serverConfigSchema>;
