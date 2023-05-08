import { client } from '@app/client';
import { globalLogger } from '@app/logger';

export abstract class DiscordCommand {
    client = client;
    service: string;
    logger: typeof globalLogger;

    constructor() {
        this.logger = globalLogger.child({
            service: `command:${this.service}`,
        });
    }
}
