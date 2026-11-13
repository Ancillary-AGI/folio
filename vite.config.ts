import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { PRICING_NOTE, renderPricingPlansHtml } from './src/lib/pricing';

/**
 * Serve the documents at the same paths the checked-in host configs use.
 * Without this, Vite's SPA fallback would answer `/admin` or `/pricing` with
 * the workbench document, and `/app/...` with nothing deep-linkable.
 */
function adminDocument(): Plugin {
  const EXACT: Record<string, string> = {
    '/app': '/index.html',
    '/': '/landing.html',
    '/pricing': '/pricing.html',
    '/admin': '/admin.html',
    '/console': '/console.html',
    '/landing': '/landing.html',
  };
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const path = (req.url ?? '').split('?')[0].replace(/\/$/, '') || '/';
    if (path.startsWith('/app/')) req.url = '/index.html';
    else if (EXACT[path]) req.url = EXACT[path];
    next();
  };
  return {
    name: 'folio-documents',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
    /* Inject the PUBLIC site configuration into the marketing page at build
     * time — env is never visible in a static file otherwise, and the admin
     * FAQ cannot reach the user's browser. The anon key is designed to be
     * public; the service key is never emitted. */
    transformIndexHtml(html) {
      /* Inject the pricing storefront into the static shell at build time.
       * The markup comes from src/lib/pricing.ts — the same module the console
       * reads — so the page and the enforcement layer can never drift apart. */
      if (html.includes('<!-- PLANS_ROOT -->')) {
        return html
          .replace('<!-- PLANS_ROOT -->', () => renderPricingPlansHtml())
          .replace('<!-- PRICING_NOTE -->', () => PRICING_NOTE);
      }
      if (!html.includes('<section id="faq"')) return html;
      const url = process.env.VITE_SUPABASE_URL ?? '';
      const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
      if (!url || !anon) {
        return html.includes('<!--FAQ-FALLBACK-->')
          ? html
          : html;
      }
      const meta = `<meta name="supabase-url" content="${url.replace(/"/g, '&quot;')}">\n    <meta name="supabase-anon" content="${anon.replace(/"/g, '&quot;')}">`;
      return html.replace('<title>', `${meta}\n    <title>`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), adminDocument()],
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      // Five documents, four applications: the marketing site (landing +
      // pricing), the instrument (the workbench), the operator console, and the
      // user console. Neither console is a route in the workbench: a designer's
      // bundle never contains either, and the workbench never links to the
      // operator console.
      input: {
        workbench: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
        landing: fileURLToPath(new URL('./landing.html', import.meta.url)),
        pricing: fileURLToPath(new URL('./pricing.html', import.meta.url)),
        console: fileURLToPath(new URL('./console.html', import.meta.url)),
      },
      output: {
        // Split the eagerly-loaded framework vendors out of the entry chunk.
        // Everything else stays auto-assigned: a catch-all would drag lazy
        // graphs (three.js, recharts, …) back into the initial payload.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/](konva|react-konva)[\\/]/.test(id)) return 'vendor-konva';
          // Heavy lazy graphs: never in the initial payload — loaded on demand
          // when the 3D viewer, robotics, or simulation panels open.
          if (/[\\/]node_modules[\\/](three|@react-three)[\\/]/.test(id)) return 'vendor-three';
          if (/[\\/]node_modules[\\/](recharts|d3-.*)[\\/]/.test(id)) return 'vendor-charts';
          return undefined;
        },
      },
    },
  },
});
