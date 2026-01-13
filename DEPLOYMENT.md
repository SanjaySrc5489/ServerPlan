# Quick Deployment Guide

## Local Development

1. **Set Database Provider**
   ```bash
   # Edit prisma/schema.prisma
   provider = "sqlite"
   ```

2. **Configure Environment**
   ```bash
   # In .env, make sure these are active:
   DATABASE_URL="file:./dev.db"
   SERVER_URL=http://localhost:3001
   ```

3. **Generate & Run**
   ```bash
   npx prisma generate
   npx prisma db push
   npm run dev
   ```

---

## Production Deployment (shorn-cut.shop)

### 1. Prepare Files

```bash
# Switch to MySQL provider
# Edit prisma/schema.prisma:
provider = "mysql"

# Generate Prisma client
npx prisma generate

# Install dependencies
npm install --production
```

### 2. Upload to cPanel

Upload these to `/home/username/public_html/NodeJs/`:
- `src/` folder
- `prisma/` folder
- `node_modules/` folder (or install on server)
- `package.json`
- `.env` (copy from .env.production.example)

### 3. Configure cPanel Node.js App

**Application Settings:**
- Application root: `public_html/NodeJs`
- Application URL: `https://shorn-cut.shop`
- Application startup file: `src/index.js`
- Node.js version: `20.x`

**Environment Variables:**
```
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://humahumz_guardian:GuardianPass2026@localhost:3306/humahumz_admin
JWT_SECRET=your-random-secret
SERVER_URL=https://shorn-cut.shop
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
FIREBASE_PROJECT_ID=javaion
```

### 4. Run Database Migration

```bash
source /home/username/nodevenv/public_html/NodeJs/20/bin/activate
cd /home/username/public_html/NodeJs
npx prisma db push
```

### 5. Start App

In cPanel → Setup Node.js App → Click **Start**

### 6. Test

Visit: `https://shorn-cut.shop/health`

Should return: `{"status":"ok","timestamp":"..."}`

---

## Update Android App URLs

Edit `app/src/main/java/.../Constants.java`:
```java
public static final String BASE_URL = "https://shorn-cut.shop/api/";
public static final String SOCKET_URL = "https://shorn-cut.shop";
```

## Update Admin Panel

Edit `admin/.env.production`:
```
NEXT_PUBLIC_API_URL=https://shorn-cut.shop
```

Then build:
```bash
cd admin
npm run build
```

Upload `admin/out/` contents to your admin panel hosting location.
