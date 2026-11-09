import type { IntegrationProvider } from './types.js';

/**
 * Registry for integration providers.
 * Allows registering and retrieving integration implementations.
 */
class IntegrationRegistry {
  private providers = new Map<string, IntegrationProvider<object>>();

  register(provider: IntegrationProvider<object>): void {
    if (this.providers.has(provider.type)) {
      console.warn(`Integration provider "${provider.type}" is already registered, overwriting.`);
    }
    this.providers.set(provider.type, provider);
  }

  get(type: string): IntegrationProvider<object> | undefined {
    return this.providers.get(type);
  }

  has(type: string): boolean {
    return this.providers.has(type);
  }

  getTypes(): string[] {
    return Array.from(this.providers.keys());
  }

  getAll(): IntegrationProvider<object>[] {
    return Array.from(this.providers.values());
  }

  unregister(type: string): boolean {
    return this.providers.delete(type);
  }

  clear(): void {
    this.providers.clear();
  }
}

// Singleton instance
export const integrationRegistry = new IntegrationRegistry();
