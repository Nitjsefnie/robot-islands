import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow the public hostname when proxied through nginx; the leading dot
    // covers any subdomain so we don't have to update this for future hosts.
    allowedHosts: ['.nitjsefni.eu'],
  },
});
