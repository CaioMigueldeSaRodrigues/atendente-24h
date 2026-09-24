import type { CommercialEvent } from "./domain/entities.js";
import type { CommercialEventRepository } from "./repositories.js";

export async function appendCommercialEventSafely(
  repository: CommercialEventRepository | undefined,
  createEvent: () => CommercialEvent,
): Promise<void> {
  if (repository === undefined) return;
  try {
    await repository.append(createEvent());
  } catch {
    // Analytics is secondary; recording failures must not affect the operation.
  }
}
