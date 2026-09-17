const { execSync } = require('child_process');

// CI 环境使用 migrate deploy（非交互、只应用已有 migration）
// 开发环境使用 migrate dev（可生成新 migration）
const isCI = process.env.CI === 'true' || process.env.GITLAB_CI === 'true';

const initCommand = isCI ? 'pnpm init:db:ci' : 'pnpm init:db';

console.log(`🗄️  Initializing database (${isCI ? 'CI' : 'dev'} mode)...`);

try {
  execSync(initCommand, { stdio: 'inherit' });
  console.log('✅ Database initialized');
} catch (error) {
  console.error('❌ Database initialization failed:', error.message);
  process.exit(1);
}
