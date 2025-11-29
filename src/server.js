const app = require('./app');
const { prisma } = require('./prisma');

const port = process.env.PORT || 4002;

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

const shutdown = async (signal) => {
  console.log(`Received ${signal}, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

process.on('uncaughtException', async (err) => {
  console.error('Uncaught exception', err);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('unhandledRejection', async (err) => {
  console.error('Unhandled rejection', err);
  await prisma.$disconnect();
  process.exit(1);
});
