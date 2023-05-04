import type { ColumnDefinitionBuilder, Kysely } from 'kysely';
import { sql } from 'kysely';

const createEnum = (name: string, args: string[]) => [name, sql`enum(${sql.join(args.map(arg => sql.lit(arg)))})`] as const;
const createArray = (name: string) => [name, 'json', (col: ColumnDefinitionBuilder) => col.defaultTo('[]')] as const;
const createSnowflake = (name: string, {
    notNull = false
} = {}) => [`${name}_id`, 'varchar(50)', (col: ColumnDefinitionBuilder) => notNull ? col.notNull() : col] as const;
const createSnowflakes = (name: string) => createArray(`${name}_ids`);
const createUUID = (name = 'id', {
    primary = false,
    notNull = false
} = {}) => {
    return [name, 'varchar(50)', (col: ColumnDefinitionBuilder) => {
        let response = col.defaultTo(sql`(uuid())`);

        if (primary) {
            response = response.primaryKey();
        }

        if (notNull || primary) {
            response = response.notNull();
        }

        return response;
    }] as const;
};

export const up = async (db: Kysely<unknown>) => {
    // Category
    await db.schema
        .createTable('categories')
        .ifNotExists()
        .addColumn(...createUUID('id', { primary: true }))
        .addColumn('enabled', 'boolean', col => col.defaultTo(true))
        .addColumn('name', 'varchar(100)', col => col.notNull())
        .addColumn('emoji', 'varchar(100)')
        .addColumn('reply_message', 'text', col => col.notNull())
        .addColumn('ticket_message', 'text', col => col.notNull())
        .addColumn(...createSnowflake('parent_channel'))
        .addColumn(...createSnowflake('ticket_admin_channel'))
        .addColumn(...createSnowflake('transcriptions_channel'))
        .addColumn('nsfw', 'boolean', col => col.notNull())
        .addColumn(...createSnowflakes('required_role'))
        .addColumn(...createSnowflakes('prohibited_role'))
        .addColumn(...createUUID('panel_id'))
        .execute();

    // Ticket
    await db.schema
        .createTable('tickets')
        .ifNotExists()
        .addColumn(...createUUID('id', { primary: true }))
        .addColumn('ticket_number', 'integer', col => col.notNull())
        .addColumn(...createUUID('category_id'))
        .addColumn(...createSnowflake('panel', { notNull: true }))
        .addColumn(...createEnum('state', ['OPEN', 'CLOSED']))
        .addColumn(...createSnowflake('guild', { notNull: true }))
        .addColumn(...createSnowflake('owner', { notNull: true }))
        .addColumn(...createSnowflake('claimed_by'))
        .addColumn(...createSnowflakes('staff_member'))
        .addColumn(...createSnowflake('ticket_admin_message'))
        // There should only be one row per guildId+ticketNumber
        .addUniqueConstraint('guild_id_ticket_number_unique', ['guild_id', 'ticket_number'])
        .execute();

    // GuildMember
    await db.schema
        .createTable('guild_members')
        .ifNotExists()
        .addColumn(...createUUID('id', { primary: true }))
        .addColumn(...createSnowflake('guild', { notNull: true }))
        // There should only be one row per guildId+memberId
        .addUniqueConstraint('guild_id_member_id_unique', ['guild_id', 'id'])
        .execute();

    // Guild
    await db.schema
        .createTable('guilds')
        .ifNotExists()
        .addColumn(...createUUID('id', { primary: true }))
        .addColumn('ticket_number', 'integer', col => col.notNull())
        .addColumn('enabled', 'boolean', col => col.defaultTo(true))
        .execute();

    // Panel
    await db.schema
        .createTable('panels')
        .ifNotExists()
        .addColumn(...createUUID('id', { primary: true }))
        .addColumn('enabled', 'boolean', col => col.defaultTo(true))
        .addColumn(...createSnowflake('guild', { notNull: true }))
        .addColumn(...createSnowflake('channel', { notNull: true }))
        .addColumn(...createSnowflakes('manager_role'))
        .addColumn(...createSnowflakes('category'))
        .addColumn('button_message', 'varchar(50)')
        .execute();
};

export const down = async (db: Kysely<unknown>) => {
    await db.schema.dropTable('categories').execute();
    await db.schema.dropTable('tickets').execute();
    await db.schema.dropTable('guild_members').execute();
    await db.schema.dropTable('guilds').execute();
    await db.schema.dropTable('panels').execute();
};
