import type { Kysely } from 'kysely';

export const up = async (db: Kysely<unknown>) => {
    // Update tickets
    await db.schema
        .alterTable('tickets')
        .addColumn('channel_id', 'varchar(36)')
        .execute();
};

export const down = async (db: Kysely<unknown>) => {
    await db.schema.alterTable('tickets').dropColumn('channel_id').execute();
};