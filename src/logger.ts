import * as winston from 'winston';
import { WinstonTransport as AxiomTransport } from '@axiomhq/axiom-node';
import chalk from 'chalk';
import * as pkg from '@app/../package.json';
import { getCommitHash } from '@app/common/get-commit-hash';
import { format } from 'winston';

export const globalLogger = winston.createLogger({
    level: 'info',
    format: format.combine(
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: {
        botName: pkg.name,
        pid: process.pid,
        commitHash: getCommitHash(),
    },
    transports: [],
});

const logLevelColours = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    verbose: 'blue',
    debug: 'magenta',
} as const;

const colourLevel = (level: keyof typeof logLevelColours) => {
    const colour = logLevelColours[level];
    return chalk[colour](level);
};

if (process.env.NODE_ENV === 'test') {
    globalLogger.silent = true;
}

if (process.env.AXIOM_TOKEN) {
    globalLogger.add(new AxiomTransport());
}

// Add the console logger if we're not running tests and there are no transports
if (process.env.NODE_ENV !== 'test' && globalLogger.transports.length === 0) {
    globalLogger.add(
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ service, level, message, timestamp, ...extras }) => {
                    const args = extras[Symbol.for('splat')] as unknown[];
                    const strArgs = (args ?? []).map(arg => JSON.stringify(arg)).join(' ');
                    return `${new Date(timestamp as string).toLocaleTimeString('en')} [${(service as string) ?? 'app'}] [${colourLevel(level as keyof typeof logLevelColours)}]: ${message as string} ${strArgs}`;
                }),
            ),
        }),
    );
}