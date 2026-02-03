import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://flowtask:flowtask@localhost:5432/flowtask',
  },
  verbose: true,
  strict: true,
});
