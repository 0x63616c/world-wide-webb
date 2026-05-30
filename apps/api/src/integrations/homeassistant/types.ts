export interface HaEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_updated: string;
  last_changed?: string;
}

export class HaError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HaError";
  }
}
