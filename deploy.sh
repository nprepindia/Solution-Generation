# deploy.sh
#!/usr/bin/env bash
git pull origin main
npm install
npm run build
pm2 restart solution-generator
