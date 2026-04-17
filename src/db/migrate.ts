import { getKnex, getTableName } from '../core/config';

export async function up() {
    const knex = getKnex();
    const tableName = getTableName();

    const exists = await knex.schema.hasTable(tableName);
    if (!exists) {
        await knex.schema.createTable(tableName, (table) => {
            table.bigIncrements('id').primary();
            table.string('user_id').notNullable();
            table.text('content').notNullable();

            table.integer('depth').notNullable().defaultTo(0);
            table.string('comment_path', 1024).notNullable();
            table.string('entity_path', 255).notNullable();
            table.bigInteger('parent_id').nullable();

            table.timestamps(true, true);
            table.timestamp('deleted_at').nullable();

            // Indexes for efficient path-based hierarchical querying
            table.index(['entity_path', 'comment_path'], 'idx_entity_path_comment_path');
            table.index(['parent_id'], 'idx_parent_id');
            table.index(['user_id'], 'idx_user_id');
        });
        console.log(`Created table: ${tableName}`);
    } else {
        console.log(`Table ${tableName} already exists. No action taken.`);
    }

    // Normally we would close it if we are just a script,
    // but if called from an app, we don't.
}

export async function down() {
    const knex = getKnex();
    const tableName = getTableName();
    await knex.schema.dropTableIfExists(tableName);
    console.log(`Dropped table: ${tableName}`);
}
