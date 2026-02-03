import type { IntegrationProvider } from './types.js';

/**
 * Registry for integration providers.
 * Allows registering and retrieving integration implementations.
 */
class IntegrationRegistry {
  private providers = new Map<string, IntegrationProvider>();

  /**
   * Register an integration provider.
   */
  register(provider: IntegrationProvider): void {
    if (this.providers.has(provider.type)) {
      console.warn(`Integration provider "${provider.type}" is already registered, overwriting.`);
    }
    this.providers.set(provider.type, provider);
  }

  /**
   * Get an integration provider by type.
   */
  get<T extends IntegrationProvider>(type: string): T | undefined {
    return this.providers.get(type) as T | undefined;
  }

  /**
   * Check if an integration provider is registered.
   */
  has(type: string): boolean {
    return this.providers.has(type);
  }

  /**
   * Get all registered integration types.
   */
  getTypes(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all registered providers.
   */
  getAll(): IntegrationProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Unregister an integration provider.
   */
  unregister(type: string): boolean {
    return this.providers.delete(type);
  }

  /**
   * Clear all registered providers.
   */
  clear(): void {
    this.providers.clear();
  }
}

// Singleton instance
export const integrationRegistry = new IntegrationRegistry();
