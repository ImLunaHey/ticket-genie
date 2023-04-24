import { startBot } from '@app/bot';
import { globalLogger } from '@app/logger';
import { seedDatabase } from '@app/seed';

const main = async () => {
    // Seed the database
    await seedDatabase();

    // Start the discord bot
    await startBot();
};

main().catch((error: unknown) => {
    if (!(error instanceof Error)) throw new Error(`Unknown error "${String(error)}"`);
    globalLogger.error('Failed to start app', { error });
    process.exit(1);
});
