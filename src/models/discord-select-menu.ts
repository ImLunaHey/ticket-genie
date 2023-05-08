import { client } from '@app/client';
import { globalLogger } from '@app/logger';

export abstract class DiscordSelectMenu {
    client = client;
    logger: typeof globalLogger;

    constructor(private service: string) {
        this.logger = globalLogger.child({
            service: `select-menu:${this.service}`,
        });
    }
}
