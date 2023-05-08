import { client } from '@app/client';
import { globalLogger } from '@app/logger';

export abstract class DiscordCommand {
    client = client;
    logger: typeof globalLogger;

    constructor(private service: string) {
        this.logger = globalLogger.child({
            service: `command:${this.service}`,
        });
    }
}
