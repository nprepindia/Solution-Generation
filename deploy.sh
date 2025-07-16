# deploy.sh
#!/usr/bin/env bash
git pull origin main
pnpm install
pnpm run build
pm2 restart solution-generator
