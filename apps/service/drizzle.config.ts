import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infrastructure/schema.ts',
  out: '../../migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['PAYMENT_ORCHESTRATION_DATABASE_URL']
      ?? process.env['DATABASE_URL']
      ?? 'postgresql://drizzle:drizzle@localhost:5432/drizzle',
  },
});
