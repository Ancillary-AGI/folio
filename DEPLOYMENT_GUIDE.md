# Engineering IDE Pro - Deployment Guide

## 🚀 Quick Start

### Prerequisites
```bash
Node.js 18+ (LTS recommended)
npm 9+ or yarn 1.22+
Git
```

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd engineering-ide-pro

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
```

### Environment Configuration

Edit `.env.local` with your credentials:

```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# OpenAI Configuration (for AI features)
VITE_OPENAI_API_KEY=your_openai_api_key

# Optional: Custom API endpoints
VITE_API_URL=https://your-api.com
```

### Development

```bash
# Start development server
npm run dev

# Application will be available at:
# http://localhost:5173
```

### Production Build

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview

# Output will be in ./dist directory
```

## 📦 Deployment Options

### Option 1: Vercel (Recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
# Project Settings > Environment Variables
```

**Vercel Configuration** (`vercel.json`):
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "env": {
    "VITE_SUPABASE_URL": "@supabase-url",
    "VITE_SUPABASE_ANON_KEY": "@supabase-anon-key",
    "VITE_OPENAI_API_KEY": "@openai-api-key"
  }
}
```

### Option 2: Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
netlify deploy --prod

# Or connect via Netlify dashboard
```

**Netlify Configuration** (`netlify.toml`):
```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Option 3: Docker

**Dockerfile**:
```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Build and Run**:
```bash
# Build Docker image
docker build -t engineering-ide-pro .

# Run container
docker run -p 80:80 \
  -e VITE_SUPABASE_URL=your_url \
  -e VITE_SUPABASE_ANON_KEY=your_key \
  engineering-ide-pro
```

### Option 4: AWS S3 + CloudFront

```bash
# Build the application
npm run build

# Install AWS CLI
# Configure AWS credentials
aws configure

# Create S3 bucket
aws s3 mb s3://engineering-ide-pro

# Upload build files
aws s3 sync dist/ s3://engineering-ide-pro --delete

# Configure CloudFront distribution
# Point to S3 bucket
# Enable HTTPS
# Set custom domain
```

### Option 5: Self-Hosted (VPS)

```bash
# On your server (Ubuntu/Debian)
sudo apt update
sudo apt install nginx nodejs npm

# Clone and build
git clone <repository-url>
cd engineering-ide-pro
npm install
npm run build

# Configure Nginx
sudo nano /etc/nginx/sites-available/engineering-ide-pro
```

**Nginx Configuration**:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/engineering-ide-pro/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Enable gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

```bash
# Enable site and restart Nginx
sudo ln -s /etc/nginx/sites-available/engineering-ide-pro /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 🔧 Configuration

### Supabase Setup

1. **Create Supabase Project**
   - Go to https://supabase.com
   - Create new project
   - Note your project URL and anon key

2. **Database Schema**
   ```sql
   -- Run these migrations in Supabase SQL Editor
   -- See supabase/migrations/ for complete schema
   ```

3. **Enable Authentication**
   - Enable Email/Password auth
   - Configure email templates
   - Set up OAuth providers (optional)

4. **Storage Buckets**
   ```sql
   -- Create storage buckets for project files
   INSERT INTO storage.buckets (id, name, public)
   VALUES ('projects', 'projects', false);
   ```

### OpenAI API Setup

1. Get API key from https://platform.openai.com
2. Add to environment variables
3. Configure rate limits and usage quotas

### Custom Domain

#### Vercel
```bash
# Add domain in Vercel dashboard
vercel domains add your-domain.com

# Configure DNS records
# A record: 76.76.21.21
# CNAME: cname.vercel-dns.com
```

#### Netlify
```bash
# Add domain in Netlify dashboard
# Configure DNS or use Netlify DNS
```

## 🔒 Security

### Environment Variables
- ✅ Never commit `.env` files
- ✅ Use environment-specific variables
- ✅ Rotate API keys regularly
- ✅ Use secrets management in production

### HTTPS
- ✅ Always use HTTPS in production
- ✅ Enable HSTS headers
- ✅ Configure SSL certificates

### Content Security Policy
Add to `index.html`:
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline' 'unsafe-eval'; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: https:; 
               connect-src 'self' https://*.supabase.co https://api.openai.com;">
```

## 📊 Monitoring

### Error Tracking
```bash
# Install Sentry
npm install @sentry/react @sentry/vite-plugin

# Configure in main.tsx
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "your-sentry-dsn",
  environment: import.meta.env.MODE,
});
```

### Analytics
```bash
# Install analytics
npm install @vercel/analytics

# Add to App.tsx
import { Analytics } from '@vercel/analytics/react';

<Analytics />
```

## 🧪 Testing Before Deployment

```bash
# Run type checking
npm run typecheck

# Run tests
npm run test

# Run linting
npm run lint

# Build and preview
npm run build
npm run preview
```

## 🔄 CI/CD Pipeline

### GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Type check
        run: npm run typecheck
        
      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          VITE_OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

## 📈 Performance Optimization

### Build Optimization
```javascript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
          'ui-vendor': ['lucide-react', '@radix-ui/react-dialog']
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
```

### Caching Strategy
```nginx
# Nginx caching
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## 🐛 Troubleshooting

### Build Fails
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install

# Clear Vite cache
rm -rf .vite
```

### Environment Variables Not Working
- Check variable names start with `VITE_`
- Restart dev server after changes
- Verify variables in build logs

### Supabase Connection Issues
- Verify URL and keys are correct
- Check CORS settings in Supabase
- Ensure RLS policies are configured

## 📞 Support

- Documentation: See project README.md
- Issues: GitHub Issues
- Community: Discord/Slack channel

## ✅ Deployment Checklist

- [ ] Environment variables configured
- [ ] Supabase project set up
- [ ] Database migrations run
- [ ] OpenAI API key added
- [ ] Build completes successfully
- [ ] All tests passing
- [ ] Custom domain configured (if applicable)
- [ ] HTTPS enabled
- [ ] Error tracking configured
- [ ] Analytics set up
- [ ] Backup strategy in place
- [ ] Monitoring alerts configured

---

**Engineering IDE Pro is ready for deployment!**

Choose your preferred deployment method and follow the steps above. The application is production-ready and fully functional.
