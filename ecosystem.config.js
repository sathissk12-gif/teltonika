module.exports = {
  apps: [
    {
      name: 'teltonika-telematics',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        TCP_PORT: 5023,
        HTTP_PORT: 3001
      }
    }
  ]
};
