export class RequestVersionTracker {
  private readonly versions = new Map<string, number>();

  next(id: string): number {
    const version = (this.versions.get(id) ?? 0) + 1;
    this.versions.set(id, version);
    return version;
  }

  isLatest(id: string, version: number): boolean {
    return this.versions.get(id) === version;
  }

  delete(id: string): void {
    this.versions.delete(id);
  }
}
